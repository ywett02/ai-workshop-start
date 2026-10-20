---
name: code-review
description: Review code changes with a short summary and actionable inline comments that explain where and how to reproduce each issue.
---

# Code review

Review the changes against the repository specs and relevant surrounding code. Focus on concrete bugs and regressions; omit speculative issues and style preferences.

Keep the review short: a brief summary followed by inline comments on the smallest relevant changed line range. If inline comments are unavailable, label each finding with its file path and line range.

Each finding comment must include:

- The issue and its impact.
- Where it occurs: the file and line, plus the affected command, endpoint, or user flow.
- How to reproduce: required setup, exact steps or command and inputs, and expected versus actual behavior.

Verify findings when practical. Clearly distinguish observed results from reproduction steps inferred from the code. Mention any material verification gaps.

If no blocking issues are found, publish a top-level comment on the reviewed pull request: "Everything looks good; no blocking issues found." This also applies when there are only non-blocking findings; keep those findings in their inline comments. Include any material verification gaps in the summary comment. For a local review without a pull request, include the same summary in the response.
