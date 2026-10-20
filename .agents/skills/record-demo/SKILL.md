---
name: record-demo
description: Use when asked to record a video, screencast, or demo of Skill Atlas web features (for docs/demo/, a PR, or a review), or to re-record an existing demo after the UI changed.
---

# Record demo

Record the real web view with Playwright: one short WebM per feature, saved to `docs/demo/<feature>.webm`.

## 1. Plan the scenarios

- **One video per feature.** Never combine features into one video, even if the request says "a video of both".
- Each scenario is 20–40 seconds and shows the feature's states from `spec/web.md`: the main path, plus the notable states (no matches, streaming progress, warnings, Clear filter).
- Use live GitHub inputs with stable, small results. `JetBrains/kotlin` (about 7 skills) and the `anthropics` organization (about 115 repositories, ~30 s scan) work well. Avoid huge organizations such as `JetBrains`.
- Scenarios live in `.agents/skills/record-demo/scripts/record.ts`. It already has `skill-filter` and `organization-scan`, so reuse or edit those before adding new ones. Select elements with the IDs in `src/web/index.html`. Type with `typeSlowly` and pause 1.5–2.5 s after each visible change so viewers can follow it.

## 2. Record

Run each command in its own Bash call; job control (`&`, `kill %1`) does not survive between calls.

1. Run `npm ci` if `node_modules` is missing. Chromium comes from `npx playwright install chromium`.
2. Start the server as a background task: `GITHUB_TOKEN=$(gh auth token) PORT=3123 npm start`. The token stays on the server.
3. Wait until it answers: `until curl -sf http://127.0.0.1:3123/ >/dev/null; do sleep 0.5; done`.
4. Record: `node .agents/skills/record-demo/scripts/record.ts http://127.0.0.1:3123 docs/demo [scenario...]`. With no scenario names it records all of them. The URL's port must match `PORT`.
5. Stop the server: `pkill -f "node src/server.ts"`.

There is no system `ffmpeg`, and you do not need one.

## 3. Verify every video

Videos fail silently: a missed selector or a timeout still produces a file. Inspect frames before you report anything:

```console
$ node .agents/skills/record-demo/scripts/frames.ts docs/demo/skill-filter.webm <scratch-dir> 1 10 18
```

This prints the duration and saves PNGs (and a `frames-viewer.html`) to a scratch directory, never the repository. Run it once with `1` to learn the duration. Then run it again with one timestamp per planned state, estimated from the scenario's pauses, and Read each PNG. Check that each state is visible: counts, highlights, the selected document, and organization progress. Re-record if a state is missing.

## Done when

- `docs/demo/` contains one `<feature>.webm` per requested feature, and old or combined videos you replaced are deleted.
- You viewed frames from every video and they show the planned states.
- The server is stopped.
- You report each file with its duration, size, and what it shows. Say that the data came from live GitHub on that date. Commit or open a PR only if asked.
