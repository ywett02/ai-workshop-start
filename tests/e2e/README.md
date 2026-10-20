# Real repository acceptance tests

Run `npm run test:e2e` with Node 24+, network access to GitHub, and preferably
`GITHUB_TOKEN` for the higher API rate limit. CI supplies its read-only token.
`npm test` runs the separate offline integration tests.

Each test launches the checked-in `skill-atlas` executable as a child process,
scans a real public repository at a full commit SHA from
[`repositories.ts`](repositories.ts), requires a successful exit, and compares
both output streams exactly with [`expected/`](expected/). There are no response
mocks and no automatic expectation updates. Network errors and timeouts fail.

The pinned repositories cover:

- MPS: copies in `.agents/skills` and `.claude/skills` count once; product
  resources do not become project skills or copies.
- android: `agent/skills/writing-lint-checks/SKILL.md` is a project skill.
- koog: skills under `integration-tests` are excluded.

Android is pinned to the commit adding `writing-lint-checks`, before the bundled
skills were removed from its default branch. The expected project skill counts
are 42 for MPS, four for android, and two for koog.

MPS and android have truncated recursive trees at these commits; their expected
stderr includes the warning about falling back to the allowed skill roots.

To deliberately refresh an expectation, run the exact command with its pinned
commit, capture each stream, inspect the changes against the repository's files,
and rerun the suite. For example, from the project root:

```sh
./skill-atlas scan github.com/JetBrains/MPS/tree/d7e4f5c1394535b05e90dde6e3e7e8a3f3e174a2 \
  > tests/e2e/expected/mps.stdout.txt \
  2> tests/e2e/expected/mps.stderr.txt
npm run test:e2e
```

For a commit upgrade, update the SHA in `repositories.ts` and refresh the matching
output files together. Expectations retain the real commit-pinned links and
trailing newlines. Do not normalize output or accept new warnings automatically.
