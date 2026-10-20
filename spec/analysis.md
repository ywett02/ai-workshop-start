# Repository analysis

## Input

A **GitHub repository** URL, optionally ending in `/tree/<full 40-character commit SHA>`,
or a local directory. An unpinned URL scans the default branch's resolved commit.

## Output

Every **project skill**: **name**, **description**, **link**, and paths to any copies.

## Architecture

Core: fetch → find → group copies → parse. CLI: a *thin client*.

Skill: id = `repo:path`, repository, canonical path, name, description, commit,
copy paths. The ID uses the canonical path, not the display name.

## Details

- **GitHub API**, no clone; *under 5 s* for intellij-community
- The display name: nonempty front-matter name, else the skill directory name
- The description: full front-matter description, else an empty string
- GitHub files are read at the *scanned commit*, and links pin that commit
- An explicit commit pins discovery as well as file reads and links. Use Git
  trees even with `GITHUB_TOKEN`, because code search only indexes the default
  branch. A missing commit fails with exit code 1; never fall back to the default branch.
- Authenticated search candidates are checked against commit-pinned Git trees
  to exclude symbolic links, including linked ancestor directories
- Local scans inspect the current directory and use file links; commit is empty
- Missing, unclosed, malformed, or non-mapping front matter → a *warning*, the
  directory name and an empty description; the scan goes on
- An unreadable skill file → a warning; skip that occurrence
- Unreachable repository → a clear message, exit code 1
- An incomplete listing → a warning that the result may omit project skills;
  a limited search must not be presented as exhaustive

## What is a project skill?

A project skill provides instructions for an agent working on the repository.
Its entry point is `<root>/<name>/SKILL.md`, where `<root>` is one of:

- `.agents/skills`
- `.claude/skills`
- `.github/skills`
- `agent/skills`

Roots are relative to the scanned repository's top-level directory. `<name>` is
one directory segment. Paths are case-sensitive, and `SKILL.md` must be a regular
file; do not follow symbolic links.

- The same `<name>` in two or more roots → **one skill**, with the other paths
  recorded as copies. Identity comes from the directory name, not YAML metadata
  or content equality. Copies in different repositories remain separate.
- Choose the lexicographically smallest readable path as the canonical occurrence;
  use its metadata and link. Sort the other readable paths in `copies`. Ordering
  is case-sensitive and locale-independent, so `.agents` precedes `.claude`.
- Different `SKILL.md` contents for the same `<name>` → still one skill; warn
  about conflicting copies and use the canonical occurrence. Supporting files
  do not change the grouping rule.
- Different directory names → separate skills, even if their front-matter names
  or contents match.
- Anything else → **not a project skill**. This includes product resources,
  test data, arbitrary custom folders, nested module roots, and a repository-level
  `SKILL.md`. Excluded files do not affect counts, copies, or metadata warnings.

The four edge cases have these expected outcomes:

| Case | Repository-relative paths | Result |
| --- | --- | --- |
| Duplicates in `.agents` and `.claude` (JetBrains/MPS) | `.agents/skills/mps-tests/SKILL.md` and `.claude/skills/mps-tests/SKILL.md` | One `mps-tests` skill; canonical `.agents` link and `.claude` copy path. |
| An unusual folder (JetBrains/android) | `agent/skills/writing-lint-checks/SKILL.md` | Include: `agent/skills` is an allowed root. |
| Part of the product (JetBrains/MPS) | `plugins/mcp-tools/resources/…/skills/mps-aspect-generator/SKILL.md` | Exclude: outside the allowed roots. |
| Test data (JetBrains/koog) | `integration-tests/src/jvmTest/resources/skills/weather-retrieval/SKILL.md` | Exclude: outside the allowed roots. |

Offline integration tests must cover these cases and the boundary rules above, using
local repositories or recorded GitHub responses rather than live repository
contents. Acceptance coverage lives in `tests/project-skills.test.ts` and
`tests/github-scan.test.ts`. The live performance check in `tests/performance.test.ts` runs
only with `SKILL_ATLAS_LIVE_TESTS=1`; offline results do not verify GitHub latency.

Live end-to-end acceptance tests in `tests/e2e/repositories.test.ts` run the actual
`./skill-atlas scan github.com/<repository>/tree/<commit>` executable against
JetBrains/MPS, JetBrains/android, and JetBrains/koog at the full commit SHAs in
`tests/e2e/repositories.ts`. Compare stdout and stderr exactly (including trailing
newlines) with the checked-in text files in `tests/e2e/expected/`, and require exit
code 0. These exercise MPS copy grouping and product exclusion, Android's
`agent/skills` root, and koog's test-data exclusion on real repositories.
`npm run test:e2e` requires network access; CI runs it with `GITHUB_TOKEN`.
Network failures, rate limits, timeouts, and unexpected output fail these tests.
`npm test` keeps the offline integration suite independent of GitHub availability.
