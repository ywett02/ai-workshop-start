# Demo tests and screenshots

`npm run e2e` runs the web demos as Playwright tests in `e2e/`, separately from `npm test`.

- Each feature is one test that walks through its demo: `skill filter` (repository scan,
  matches, no matches, clear) and `organization scan` (mid-scan progress, results, filter
  across repositories).
- Runs are deterministic. GitHub answers come from fixed recordings in `e2e/data.ts`; nothing
  reaches the network. The viewport (1280×800), scale, locale, time zone, and color scheme are
  fixed. The organization scan holds one repository's answer so its mid-scan moment is the same
  on every run.
- Every run records a video of each test in `test-results/`.
- Key moments are full-page screenshots compared with baselines in `e2e/__screenshots__/`.
  Any changed pixel fails the comparison.
- Baselines are rendered on Linux in the `mcr.microsoft.com/playwright` image matching the
  installed Playwright version, which pins the browser and fonts. CI compares in that same image.
  On other platforms the tests run and record videos but skip screenshot comparisons.
- CI uploads the videos and the HTML report, including expected, actual, and diff images of any
  failed comparison, as the `e2e-results` artifact.
- A failed comparison does not stop its test, so every changed key moment is reported. On pull
  requests from this repository, CI keeps one comment up to date: each changed screenshot with
  its pixel count and expected, actual, and diff images, other test failures, and how to accept
  the change. When everything matches again, the comment says so. The images are committed to
  the `e2e-diffs` branch, under the pull request and run, because comments cannot attach files.
  `tests/e2e-report.test.ts` covers the comment.
- To accept new baselines, add the `update-screenshots` label to the pull request, or run the
  Update screenshots workflow on a branch. It renders the screenshots in the CI image, commits
  any changes to the branch, starts CI for that commit, and removes the label. It refuses the
  default branch.
- Baselines change only that way, never by hand or by running `--update-snapshots` locally, so
  every change is first seen failing on CI. For pull requests, CI fails when any screenshot
  differing from the base branch lacks GitHub-hosted provenance for its last modifying commit.
  The Update screenshots workflow uploads a `baseline-commit-<full SHA>` artifact after pushing
  that commit and before starting CI. CI accepts only records belonging to this repository's
  Update screenshots workflow (including paginated runs/artifacts), never Git author names or
  commit-message claims. A later local edit, addition, deletion, or rename requires acceptance
  again. Unchanged baselines require no API lookup; API failures reject changed baselines.
  Records last 90 days; for missing or expired records, restore unaccepted baselines from the
  base branch, then rerun the workflow to render and commit them again.
  The record proves rendering and publication even if later cleanup or CI dispatch fails.

Baseline guard integration coverage in `tests/baselines.test.ts` executes the actual CI script
against temporary Git histories and recorded GitHub Actions API responses.
