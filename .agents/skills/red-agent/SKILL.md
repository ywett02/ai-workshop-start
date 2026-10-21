---
name: red-agent
description: Use when asked to break, attack, fuzz, or bug-hunt the Skill Atlas web view, or to file bug issues found by exploratory testing of the local web UI.
---

# Red agent

Try to break the local web view, then file one GitHub issue per confirmed bug, each with reproduction steps and a video, labelled `Delegate to AI`. Never fix the code yourself.

## 1. Know the target

1. Read `spec/web.md` and `spec/analysis.md`. Every "must", "never", and listed state there is a claim to attack. A bug is behavior that contradicts the spec, a crash or hang, a security hole, or an accessibility barrier the spec rules out.
2. Read `src/web/` and `src/server.ts` to find the inputs: the repository/organization field, the mode selector, the skill filter, skill selection, `GET /api/scan`, and NDJSON streaming.
3. List open issues (`gh issue list --state all --limit 200`) so you do not file duplicates.

## 2. Attack

Run `npm ci` if `node_modules` is missing; Chromium comes from `npx playwright install chromium`. Run each server command in its own Bash call.

Prefer hostile local sources, because you control them and they need no network. Write a server script in your scratch directory that calls `webFixture(files)` from `tests/web-helpers.ts` (or `createWebServer({ open })` from `src/server.ts` for custom failures), passing crafted `SKILL.md` contents, and prints its URL. Any GitHub repository link scans those files; links ending in `/missing`, `/failure`, or `/empty` give the error and empty states. Scratch scripts cannot resolve bare packages, so import repository files and Playwright by absolute path (`<repo>/node_modules/@playwright/test/index.mjs`). Use live GitHub (`GITHUB_TOKEN=$(gh auth token) PORT=3123 npm start`) only for flows that need it, such as rate limits or organization streaming. Start with small inputs such as `JetBrains/kotlin` or `anthropics`.

Drive the page with Playwright from a scratch script, selecting elements by the IDs in `src/web/index.html`. Probe at least:

- **Injection:** HTML, `<script>`, event handlers, and `javascript:` URLs in names, descriptions, paths, source, and the filter query. Check `window` for side effects, not only what is rendered.
- **Filter:** regex characters, whitespace-only queries, very long queries, Unicode case folding (`İ`, `ß`, combining marks, emoji), matches beyond the description preview, and selection after the filter changes.
- **Inputs:** malformed URLs, other hosts, local paths, repository URLs in organization mode, both parameters in one API request, non-GET methods, and path traversal in asset URLs.
- **States:** empty repositories, scan errors and retries, a second scan while the first is running, a broken or truncated NDJSON stream, and history lookups that fail.
- **Malformed data:** missing or broken front matter, huge files, invalid timestamps such as February 30.
- **Access:** keyboard-only use, focus visibility, screen reader announcements, and a 375 px wide viewport.

## 3. Confirm each bug

Reproduce each bug twice from a fresh page load and reduce it to the fewest steps. Then record it: a Playwright script with `recordVideo` (see `.agents/skills/record-demo/scripts/record.ts`) that performs only the reproduction steps, pausing 1.5–2 s on the broken state. Save it as `<scratch>/<slug>.webm`.

Check the video with `node .agents/skills/record-demo/scripts/frames.ts <scratch>/<slug>.webm <scratch>/frames 1 <t>...` and Read the frames. Re-record if the broken state is not visible. Write the video, scripts, and fixtures only to your scratch directory, never to the repository's working tree.

## 4. File one issue per bug

1. `gh` cannot attach media, so push the videos to the `red-agent-evidence` branch: clone the repository into a scratch directory, switch to that branch (create it with `git switch --orphan red-agent-evidence` if it does not exist), add each video as `<date>/<slug>.webm`, commit, and push. Never push to `main`. Link each video as `https://github.com/<owner>/<repo>/blob/red-agent-evidence/<date>/<slug>.webm?raw=true`.
2. Create each issue with `gh issue create --label "Delegate to AI" --title "<short symptom>" --body-file <file>`. One bug per issue; do not combine bugs. The body contains:
   - **Summary:** what breaks and its impact.
   - **Steps to reproduce:** numbered, from server start, including the exact input, crafted `SKILL.md` contents, or viewport, so another agent can repeat them.
   - **Expected:** quoted or cited from `spec/` where possible.
   - **Actual:** what happens, including console errors.
   - **Video:** the link from step 1.
   - **Environment:** the commit of `main` that you tested, the browser, and whether the data came from local fixtures or live GitHub.
3. If a matching issue already exists, add a comment with your reproduction there instead of opening a new one.

## Done when

- Every bug you filed reproduces from its issue's steps, and its video shows the broken state.
- Each bug has exactly one issue labelled `Delegate to AI`, with steps and a video link.
- All servers you started are stopped, and the repository's working tree is unchanged.
- You reply with one line per issue (its link and the symptom), the areas you probed that held up, and any suspected bugs you could not reproduce.
