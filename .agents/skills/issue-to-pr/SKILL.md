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

## 2. Branch

Start from an up-to-date `main`: `git fetch && git switch -c <type>/<number>-<short-slug> origin/main`, where `<type>` is `feat`, `fix`, or `docs`. Run `npm ci` in a fresh checkout.

## 3. Implement

1. Update `spec/` first so it describes the new behavior, with one case per acceptance criterion.
2. Add an integration test for every new or changed spec case, following the existing files in `tests/`. Run `npm test` and confirm the new tests fail for the right reason.
3. Implement the smallest change that makes them pass, matching the surrounding code style.
4. Run `npm test` and `npm run typecheck`; both must pass. Update `README.md` if user-facing usage changed.

Keep the change scoped to the issue. Note unrelated problems in the PR description instead of fixing them.

## 4. Open the PR

1. Commit with a conventional message (`fix: …`, `feat: …`) and push the branch.
2. `gh pr create --base main` with:
   - a short summary of the change and why;
   - `Closes #<number>`;
   - a test plan listing the commands run and their results.
3. Wait for CI: `gh pr checks <pr> --watch`. If it fails, read the logs (`gh run view <run-id> --log-failed`), fix, push, and wait again.

## Done when

- Every acceptance criterion is in `spec/` and covered by an integration test.
- `npm test` and `npm run typecheck` pass locally.
- CI is green on the PR.
- You reply with the PR link, a one-line summary, and anything left open (assumptions, follow-ups, unverified behavior).
