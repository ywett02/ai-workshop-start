---
name: address-review
description: Use when asked to address, fix, or respond to review comments or unresolved conversations on a pull request in this repository.
---

# Address review

Work through every unresolved review thread on a pull request: fix what is valid, reply in each thread, and resolve the threads you addressed.

## 1. Collect unresolved threads

1. Check out the PR branch: `gh pr checkout <number>`, then `npm ci` in a fresh checkout.
2. List the review threads (raise `first:` or paginate if a PR has more):

   ```sh
   gh api graphql -F owner='{owner}' -F repo='{repo}' -F pr=<number> -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 100) {
             nodes {
               id isResolved isOutdated path line
               comments(first: 50) { nodes { author { login } body url } }
             }
           }
         }
       }
     }'
   ```

3. Keep the threads with `isResolved: false`. Also read top-level review bodies and PR comments (`gh pr view <number> --comments`); they cannot be resolved, but may ask for changes.
4. Read the whole thread, the code it points to, and the relevant files in `spec/`. An outdated thread may already be fixed; check the current code before changing anything.

## 2. Decide on each thread

- **Valid:** the comment is correct and in scope. Fix it.
- **Already addressed:** the current code already does what was asked. Note where.
- **Disagree or unclear:** the request is wrong, contradicts `spec/`, or is ambiguous. Do not change code; reply with your reasoning or a question. Ask the user when the decision is theirs to make.
- **Out of scope:** a valid point that belongs in a separate change. Propose a follow-up issue.

Verify each claim against the code before acting; do not accept or reject a comment on the reviewer's word alone.

## 3. Fix

1. Apply the fixes, following `AGENTS.md`: update `spec/` when behavior changes, and add or update an integration test for every changed spec case.
2. Run `npm test` and `npm run typecheck`; both must pass.
3. Commit with a conventional message that names what changed (for example `fix: reject empty title`), and push. Several related threads may share one commit.

## 4. Reply and resolve

Reply in every unresolved thread, then resolve only the ones you addressed:

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

`gh pr checks <number> --watch`. If it fails, read the logs (`gh run view <run-id> --log-failed`), fix, push, and wait again.

## Done when

- Every unresolved thread has a reply, and every addressed thread is resolved.
- `npm test` and `npm run typecheck` pass locally, and CI is green.
- You reply with the PR link, the threads resolved, and the threads left open with why.
