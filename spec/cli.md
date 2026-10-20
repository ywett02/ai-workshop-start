# Command line
`./skill-atlas scan <GitHub URL | directory>`
To scan a fixed commit, use `./skill-atlas scan github.com/<owner>/<repo>/tree/<full SHA>`.
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
The result contains [project skills](analysis.md#what-is-a-project-skill); product skills and test
data are excluded. Copies for different agents count as one skill.
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**, then canonical path, using case-sensitive,
  locale-independent ordering; the description's *first sentence*
- `also in <paths>` lists the sorted repository-relative paths to other copies;
  the link points to the canonical occurrence
- Different skill directories with the same display name are printed separately,
  each with its link
- Warnings go to *stderr*, including incomplete-discovery warnings
- No project skills → `<repository> · 0 skills`, exit code 0

For the identical MPS copies, the skill is printed once:

```text
JetBrains/MPS · 1 skill
mps-tests — <first sentence of description>
  https://github.com/JetBrains/MPS/blob/<commit>/.agents/skills/mps-tests/SKILL.md
  also in .claude/skills/mps-tests/SKILL.md
```

This example assumes the two copies are the only project skill in the scan; it
does not assert a live repository count.
