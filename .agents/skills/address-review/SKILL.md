---
name: address-review
description: Use when asked to address, fix, or respond to review comments or unresolved conversations on the open pull requests in this repository.
---

# Address review

Update the existing open pull requests with fixes for their unresolved review threads. Push the fixes to each PR's own branch, reply in each thread, and resolve the threads you addressed. Never open a new PR or a separate fix branch.

Use GitHub review thread resolution to track completed work. No shared lock or reaction-based claim is required. Existing reactions do not determine whether a thread can be addressed; do not add or remove reactions as part of this workflow.

## 1. Find PRs with unresolved threads

1. List the open PRs with their review threads (raise `first:` or paginate if there are more):

   ```sh
   gh api graphql -F owner='{owner}' -F repo='{repo}' -f query='
     query($owner: String!, $repo: String!) {
       repository(owner: $owner, name: $repo) {
         pullRequests(states: OPEN, first: 50) {
           nodes {
             number title url isCrossRepository
             reviewThreads(first: 100) {
               nodes {
                 id isResolved isOutdated path line
                 comments(last: 50) {
                   nodes { id author { login } body url }
                 }
               }
             }
           }
         }
       }
     }'
   ```

2. A thread is open for work when `isResolved: false`, regardless of its reactions. Keep the PRs that have at least one such thread. If the user named specific PRs, keep only those.
3. Skip PRs from forks (`isCrossRepository: true`), since you cannot push to them; list them in your final reply.
4. Handle the remaining PRs one at a time, running steps 2–5 for each.

For each PR:

1. Check out its branch: `gh pr checkout <number>`, then `npm ci`. Run `git pull` so you start from the PR's latest commit.
2. Also read top-level review bodies and PR comments (`gh pr view <number> --comments`); they cannot be resolved, but may ask for changes.
3. Re-query the threads before working on them. Skip any that have since been resolved, and read any new comments before deciding what to do.
4. For each unresolved thread, read the whole thread, the code it points to, and the relevant files in `spec/`. An outdated thread may already be fixed; check the current code before changing anything.

## 2. Decide on each thread

- **Valid:** the comment is correct and in scope. Fix it.
- **Already addressed:** the current code already does what was asked. Note where.
- **Disagree or unclear:** the request is wrong, contradicts `spec/`, or is ambiguous. Do not change code; reply with your reasoning or a question. Ask the user when the decision is theirs to make.
- **Out of scope:** a valid point that belongs in a separate change. Propose a follow-up issue.

Verify each review request against the code before acting; do not accept or reject a comment on the reviewer's word alone.

## 3. Fix

1. Apply the fixes, following `AGENTS.md`: update `spec/` when behavior changes, and add or update an integration test for every changed spec case.
2. Run `npm test` and `npm run typecheck`; both must pass.
3. Before committing, check the PR's current head. If it changed while you worked, incorporate the latest changes and rerun the relevant checks. Commit with a conventional message that names what changed (for example `fix: reject empty title`), and push to the PR's branch with `git push`; `gh pr checkout` already set the upstream. Several related threads may share one commit. Do not force-push or rebase, since that would rewrite the history the reviewer has already seen.

## 4. Reply and resolve

Before replying, refresh the thread and check any new comments against your changes. Skip threads already resolved by someone else. Reply with the outcome, then resolve only threads whose requests are addressed. Leave unanswered questions and unaddressed requests unresolved. If a reply or resolution fails, report that failure and continue with other threads; do not mark the failed action as completed:

```sh
gh api graphql -F id=<thread-id> -f body='<reply>' -f query='
  mutation($id: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { url } }
  }'

gh api graphql -F id=<thread-id> -f query='
  mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }'
```

| Decision | Reply | Resolve? |
|---|---|---|
| Valid | What changed and the commit SHA | Yes, after the commit is pushed |
| Already addressed | Where the current code handles it | Yes |
| Disagree or unclear | Reasoning or question | No; leave it for the reviewer |
| Out of scope | Link to the follow-up issue, or the proposal | No, unless the reviewer agreed |

Answer top-level review or PR comments that asked for changes with one PR comment (`gh pr comment <number> --body ...`) listing what was done.

## 5. Wait for CI

`gh pr checks <number> --watch`. If it fails, read the logs (`gh run view <run-id> --log-failed`), fix, push, and wait again. Then move on to the next PR.

## Done when

- Every fix is pushed to the existing PR it belongs to.
- Each addressed thread has a reply and is resolved. Threads needing clarification or further work remain open; any failed replies or resolutions are reported.
- `npm test` and `npm run typecheck` pass locally on each changed branch, and CI is green.
- You reply with one line per PR: its link, the threads resolved, and the threads left open with why. List skipped PRs and any failed GitHub actions with the reason.
