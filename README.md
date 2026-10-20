# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests.

`npm run test:e2e` runs the real CLI against fixed commits of JetBrains/MPS,
JetBrains/android, and JetBrains/koog over the network. CI runs this suite with
`GITHUB_TOKEN`; locally, export a token to avoid the unauthenticated API limit.
The tests compare stdout and stderr byte for byte with the text in
[`tests/e2e/expected/`](tests/e2e/expected/). See
[`tests/e2e/README.md`](tests/e2e/README.md) for the pinned inputs and how to update expectations.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
