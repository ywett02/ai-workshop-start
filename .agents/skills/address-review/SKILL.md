---
name: address-review
description: Use when asked to address, fix, or respond to review comments or unresolved conversations on the open pull requests in this repository.
---

# Address review

Update the existing open pull requests with fixes for their unresolved review threads. Push the fixes to each PR's own branch, reply in each thread, and resolve the threads you addressed. Never open a new PR or a separate fix branch.

A 👀 (`EYES`) reaction on a thread's last comment marks a claim; never work on a claimed thread. Reactions are status markers, not locks: GitHub deduplicates identical reactions from the same account, so a count of one cannot prove exclusive ownership.

## 0. Require enforced serialization

Before claiming threads or making any repository or GitHub changes, verify that the launcher holds an exclusive lock for this repository for the entire run, including pushes, replies, resolution, and cleanup. Every launcher that runs this skill against the repository must use the same lock, regardless of GitHub account. The lock must distinguish individual runs and prevent a second run from entering until the first finishes; checking reactions, posting a run ID, or waiting and re-querying is not sufficient.

For example, if GitHub Actions is the sole launcher, configure **every** workflow that invokes this skill with the same repository-wide concurrency group (do not include the workflow name, branch, PR, or run ID):

```yaml
concurrency:
  group: address-review-${{ github.repository }}
  cancel-in-progress: false
```

This serializes running jobs in that group; it does not guarantee that every pending run will execute. It also does not lock out Air Automations or other launchers. With multiple launchers, require a shared exclusive lock service instead, held until this run exits. A machine-local lock is insufficient across cloud environments.

Verify the launcher configuration and evidence that this run holds the lock. If that evidence is unavailable, or any competing launcher bypasses the lock, stop without claiming, editing, pushing, replying, resolving, or removing reactions. Report that enforced repository-wide serialization must be configured. Do not assume that using the same automation, account, or schedule serializes runs.

Only after this prerequisite is satisfied, continue below. Keep the lock until all work and claim cleanup are complete; release it through the launcher's guaranteed exit cleanup, including on failures.

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
                   nodes { id author { login } body url reactions(content: EYES) { totalCount } }
                 }
               }
             }
           }
         }
       }
     }'
   ```

2. A thread is open for work when `isResolved: false` and its last comment has no 👀 reaction (`reactions.totalCount == 0`). Keep the PRs that have at least one such thread. If the user named specific PRs, keep only those.
3. Skip PRs from forks (`isCrossRepository: true`), since you cannot push to them; list them in your final reply.
4. Handle the remaining PRs one at a time, running steps 2–5 for each.

For each PR:

1. Check out its branch: `gh pr checkout <number>`, then `npm ci`. Run `git pull` so you start from the PR's latest commit.
2. Also read top-level review bodies and PR comments (`gh pr view <number> --comments`); they cannot be resolved, but may ask for changes.
3. Claim each thread open for work before touching it (see [Claim](#claim)). Then re-query the threads: if another 👀 or a new comment appeared on a thread meanwhile, leave that thread alone and remove only a reaction you know this run created. This is a stale-state check, not the concurrency guarantee; the launcher lock provides exclusivity even when runs share a GitHub account.
4. For each claimed thread, read the whole thread, the code it points to, and the relevant files in `spec/`. An outdated thread may already be fixed; check the current code before changing anything.

## Claim

With the launcher lock held, recheck that the last comment has no 👀 reaction, then react 👀 on the thread's last comment (`<comment-id>` is that comment's `id`):

```sh
gh api graphql -F id=<comment-id> -f query='
  mutation($id: ID!) { addReaction(input: {subjectId: $id, content: EYES}) { reaction { content } } }'
```

If you stop before replying in a claimed thread (the user decides to skip it, or you abort), release it with the same mutation using `removeReaction` so another agent can pick it up.

## 2. Decide on each thread

- **Valid:** the comment is correct and in scope. Fix it.
- **Already addressed:** the current code already does what was asked. Note where.
- **Disagree or unclear:** the request is wrong, contradicts `spec/`, or is ambiguous. Do not change code; reply with your reasoning or a question. Ask the user when the decision is theirs to make.
- **Out of scope:** a valid point that belongs in a separate change. Propose a follow-up issue.

Verify each claim against the code before acting; do not accept or reject a comment on the reviewer's word alone.

## 3. Fix

1. Apply the fixes, following `AGENTS.md`: update `spec/` when behavior changes, and add or update an integration test for every changed spec case.
2. Run `npm test` and `npm run typecheck`; both must pass.
3. Commit with a conventional message that names what changed (for example `fix: reject empty title`), and push to the PR's branch with `git push`; `gh pr checkout` already set the upstream. Several related threads may share one commit. Do not force-push or rebase, since that would rewrite the history the reviewer has already seen.

## 4. Reply and resolve

Reply in every thread you claimed, then resolve only the ones you addressed. For a thread you leave open, react 👀 on your own reply (as in [Claim](#claim)), so it stays claimed until the reviewer answers with a new comment:

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

- Enforced repository-wide serialization was verified before mutations and held throughout the run.
- Every fix is pushed to the existing PR it belongs to.
- Each thread you claimed has a reply; each addressed thread is resolved, and each thread left open has 👀 on your reply. Threads claimed by other agents were not touched.
- `npm test` and `npm run typecheck` pass locally on each changed branch, and CI is green.
- You reply with one line per PR: its link, the threads resolved, the threads left open with why, and the threads skipped because another agent claimed them. List skipped PRs with the reason.
