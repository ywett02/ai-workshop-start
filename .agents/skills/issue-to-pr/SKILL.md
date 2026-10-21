---
name: issue-to-pr
description: Use when asked to resolve, fix, or implement a GitHub issue in this repository and deliver the result as a pull request.
---

# Issue to PR

Turn one GitHub issue into a merge-ready pull request: spec, code, integration tests, green CI.

## 1. Understand the issue

1. Read it with comments: `gh issue view <number> --comments`.
2. Read the relevant files in `spec/` and the code the issue touches.
3. Write down the acceptance criteria as concrete cases. If the issue is ambiguous or conflicts with `spec/`, ask before implementing; do not guess.

## Asking questions

Ask every question about the task in the `#ikvl` channel of the `aiworkshopatjetbrains.slack.com` Slack workspace, not only in your reply. This applies at any step, including mid-implementation. Write one self-contained message: the issue link, what is unclear, the options you see, and the one you recommend. Then run this as a background task:

```console
$ node .agents/skills/issue-to-pr/scripts/ask-slack.ts "<question>" [timeout-minutes]
```

It posts with `SLACK_BOT_TOKEN`, waits for the first human reply in the message's thread (default 60 minutes), prints it, and exits 0. Exit 2 means nobody answered: stop and tell the user the question is still open. If `SLACK_BOT_TOKEN` is unset or Slack returns an error (`not_in_channel`, `missing_scope`), ask the user directly and mention the error. The bot needs the `chat:write` and `channels:history` scopes and must be a member of `#ikvl`.

Work only on parts the answer cannot change while you wait. Follow the answer, and quote it in the PR description.

## 2. Branch

Start from an up-to-date `main`: `git fetch && git switch -c <type>/<number>-<short-slug> origin/main`, where `<type>` is `feat`, `fix`, or `docs`. Run `npm ci` in a fresh checkout.

## 3. Implement

1. Update `spec/` first so it describes the new behavior, with one case per acceptance criterion.
2. Add an integration test for every new or changed spec case, following the existing files in `tests/`. Run `npm test` and confirm the new tests fail for the right reason.
3. Implement the smallest change that makes them pass, matching the surrounding code style.
4. Run `npm test` and `npm run typecheck`; both must pass. Update `README.md` if user-facing usage changed.
5. Never update `e2e/__screenshots__/` yourself (no `--update-snapshots`). If your change alters the UI, CI's `e2e` job fails and shows the diff; that failure is expected. Say in the PR that the screenshots change and why, and leave accepting them to the reviewer, who adds the `update-screenshots` label.

Keep the change scoped to the issue. Note unrelated problems in the PR description instead of fixing them.

## 4. Open the PR

1. Commit with a conventional message (`fix: …`, `feat: …`) and push the branch.
2. `gh pr create --base main` with:
   - a short summary of the change and why;
   - `Closes #<number>`;
   - a test plan listing the commands run and their results;
   - for a UI change, a screenshot (or a short video for interactions and animations) of the new behavior, with a before/after pair when it changes existing UI. Capture it from the running app, not a mockup. `gh` cannot upload media, so if you cannot attach it yourself, say so in your reply and ask the user to add it.
3. Wait for CI: `gh pr checks <pr> --watch`. If it fails, read the logs (`gh run view <run-id> --log-failed`), fix, push, and wait again.

## Done when

- Every acceptance criterion is in `spec/` and covered by an integration test.
- `npm test` and `npm run typecheck` pass locally.
- CI is green on the PR, except an `e2e` screenshot diff your UI change causes; it waits for the reviewer's `update-screenshots` label.
- For a UI change, the PR shows it in a screenshot or video.
- You reply with the PR link, a one-line summary, and anything left open (assumptions, follow-ups, unverified behavior).
