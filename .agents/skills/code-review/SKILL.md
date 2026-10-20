---
name: code-review
description: Use when asked to review a pull request, branch, or local diff in this repository, or to check changes before they are merged.
---

# Code review

Find concrete bugs and regressions in the change, back each one with reproduction steps, and report them briefly.

## Gather context

1. Get the change: `gh pr diff <number>` for a pull request; otherwise `git diff main...HEAD` plus uncommitted changes.
2. Read the relevant files in `spec/` and the code around each changed hunk, not only the diff.
3. Run `npm test` when the change touches code or tests.

## Classify findings

- **Blocking:** wrong behavior, regression, security issue, failing test, behavior that contradicts `spec/`, or a code change without the spec update or integration test that `AGENTS.md` requires.
- **Non-blocking:** a real defect that can safely ship, such as a misleading error message. Start the comment with "Non-blocking:".
- **Omit:** speculation, style preferences, and anything you cannot tie to a specific line.

## Finding comments

Post each finding as an inline comment on the smallest relevant changed line range. If inline comments are unavailable, label it with `path:start-end`. Each comment contains:

- **Issue:** what is wrong and its impact.
- **Where:** file and line, plus the affected command, endpoint, or user flow.
- **Reproduce:** setup, exact command or steps and inputs, expected versus actual behavior.
- **Evidence:** "Verified" if you ran it, or "Inferred from code" if you did not.

If the pull request already has a comment for the same finding, reply in that thread instead of posting a duplicate.

## Summary comment

Always post one short top-level comment on the pull request (`gh pr review <number> --comment --body ...`). For a local review without a pull request, put the same summary in your response.

- With blocking findings: their count and a one-line description of each.
- Without blocking findings, including when only non-blocking findings exist: "Everything looks good; no blocking issues found."
- Material verification gaps, such as tests not run or a browser flow not exercised.
