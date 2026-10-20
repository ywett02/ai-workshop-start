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
- To accept new baselines, add the `update-screenshots` label to the pull request, or run the
  Update screenshots workflow on a branch. It renders the screenshots in the CI image, commits
  any changes to the branch, starts CI for that commit, and removes the label. It refuses the
  default branch.
- Baselines change only that way, never by hand or by running `--update-snapshots` locally, so
  every change is first seen failing on CI. For pull requests, CI fails when any screenshot
  differing from the base branch was last committed by someone other than `github-actions[bot]`.
