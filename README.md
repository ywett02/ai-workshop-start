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

To explore skills in a local web view:

```console
$ npm start
Skill Atlas: http://127.0.0.1:3000
```

Open that address, choose Repository or Organization, enter its GitHub link, and
select a skill to read its
complete SKILL.md. The view shows descriptions, copy paths, scan warnings, and
links pinned to the scanned commit. Organization mode also accepts a bare login
(such as `JetBrains`) and scans every accessible repository, including forks and
archived repositories. Skills appear as each repository is scanned, so you can
start reading before the whole organization is done. Results are grouped by repository; failures and incomplete
listings appear as warnings while available results remain usable. Without a
token only public repositories are visible. Use **Filter skills** to instantly
search names and descriptions, see highlighted matches and a matching count, or
**Clear filter** to restore the full list. Filtering uses the loaded results
without another scan. The CLI continues to scan individual
repositories or local directories. `PORT` changes the listening port.

Set `GITHUB_TOKEN` for a higher GitHub rate limit; the web server keeps it out of
the browser. `npm test` runs the tests. For browser tests, install Chromium once
with `npx playwright install chromium` (on Linux, use `--with-deps` if needed).
Alternatively, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium
executable when browser downloads are unavailable.

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
