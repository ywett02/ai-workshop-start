# Local web view

`npm start` serves Skill Atlas at `http://127.0.0.1:3000`. `PORT` overrides
the port. The server binds to loopback. No build step is required.

- Enter a GitHub repository link and submit with the button or Enter. Accept the
  same URL forms as the scanner. Local directory inputs and other hosts are rejected.
- Show a loading status, disable the form during scanning, then allow another scan.
  Clear the previous repository's results when a new scan starts.
- Use the existing [project skill rules](analysis.md). List skills in the core's
  name/path order, with the total count, repository, and abbreviated scanned commit.
- Select the first skill automatically. Selecting another skill shows its full
  name, description, canonical path, copy paths, GitHub link pinned to the scanned
  commit, and complete canonical SKILL.md source including front matter. Read the
  contents during the scan without fetching a second time.
- Wrap long URLs and other unbroken words in the selected skill's full description
  within the document width on desktop and narrow screens (including 375 px).
  Keep every character readable without horizontal page scrolling or clipping;
  skill-list descriptions remain previews.
- In the selected skill's details, show “Last updated” as an absolute UTC date and
  time, with a machine-readable timestamp. Use the committer date of the latest
  commit affecting the canonical SKILL.md, looking back from the scanned commit;
  unrelated repository commits, supporting files, and copies do not set this date.
  Query history only for readable canonical skills, once per scan; selecting or
  filtering skills makes no further history requests. Limit history lookups to
  four concurrent requests per repository. CLI scans do not request history.
- Include each skill's `lastUpdated` ISO 8601 UTC timestamp (or `null`) in the web
  API, including organization JSON and streamed results. Keep credentials on the
  server. Accept only timestamps with valid calendar and clock components (including
  Gregorian leap-year rules); reject overflow dates such as February 30 and 24:00
  before converting valid timezone offsets to UTC. If history is empty, malformed,
  unavailable, or rate limited, preserve
  the skill and its source, show “Last updated: Unknown”, and report a path-specific
  warning. Never substitute the repository's scanned commit date. Selection must
  update the date or unknown state on desktop and narrow screens.
- Show the source as plain text, with line wrapping and scrolling. Repository
  HTML and scripts must remain inert. Never inject repository text as HTML.
- Display all scan warnings, including malformed metadata, conflicting copies,
  unreadable occurrences, and incomplete discovery. An incomplete result is not
  presented as exhaustive.
- Show explicit initial, empty, and error states. A repository with no skills is
  a successful result. Show useful GitHub failure messages and allow retries.
- Keep the interface usable on narrow screens and with a keyboard. Label the
  input, announce scan status, expose the selected skill, and show focus outlines.
- After a nonempty scan, offer a labelled skill filter. Update the list immediately
  using a case-insensitive, literal substring of the name or full description;
  trim surrounding query whitespace. An empty query shows all skills in scan order.
- Highlight matching text in names and descriptions without interpreting repository
  text or the query as HTML or regular expressions. If a description match is beyond
  its usual preview, show an excerpt around that match. Preserve original character
  boundaries when lowercasing expands Unicode characters (for example, `İ`).
- Show and announce the matching count out of the repository total while filtering.
  Preserve the selected skill if it still matches; otherwise select the first match.
  No matches shows an explicit message and hides the previous skill document.
- A keyboard-accessible Clear filter button restores all skills. Filtering and
  clearing use the existing scan without network requests. Reset the query, count,
  and selection at the start of each scan; hide the filter before results, during
  loading, after errors, and for repositories with no skills. Filtering works on
  narrow screens and leaves repository information and scan warnings visible.
- Use `GITHUB_TOKEN` on the server if set; never send it to the browser. Store
  nothing on disk or in browser storage. Serve only explicitly listed assets;
  API inputs cannot request arbitrary local files. Accept only GET requests.

HTTP integration coverage lives in `tests/web.test.ts`. Browser acceptance
coverage lives in `tests/web-browser.test.ts` and runs through `npm test`, using
recorded/local sources rather than live GitHub contents.

## Organization scans

- Choose Repository (the default) or Organization. Organization mode accepts a
  GitHub organization URL, with the same optional scheme and trailing slash as
  repository URLs, or a bare organization login. Reject repository URLs, local
  paths, other hosts, and invalid logins in organization mode.
- `GET /api/scan?organization=<input>` scans every repository visible to the
  server's GitHub credentials, including forks and archived repositories. Without
  a token only public repositories are visible. Resolve the organization first;
  personal accounts are not organizations. Follow every repository-list page,
  deduplicate repositories, and scan at most four repositories concurrently.
- Organization scans find skills through each repository's Git tree, even with a
  token: GitHub allows ten code searches a minute, so searching every repository
  would take minutes. Reuse each repository's default branch from the listing
  instead of asking for the repository again.
- Return the organization login, number of discovered repositories, successful
  repository results, flattened skills, and warnings. Order repositories by ID
  using case-sensitive comparison and skills within each repository by the usual
  name/path order. Preserve distinct IDs for same-named skills across repositories.
- Show results while the organization is scanned. With `Accept: application/x-ndjson`
  the organization scan answers one JSON object per line: `start` (organization,
  repository count, listing warnings), then `repository` as each repository
  finishes (its ID, its result unless it failed, and its warnings), then `done`.
  Errors before `start` are ordinary JSON errors. The page inserts each repository
  in ID order, shows how many repositories have been checked and skills found so
  far, and keeps the filter, selection, and keyboard focus as results arrive. A
  stream that ends or breaks without `done` keeps the results so far and reports
  that they may be incomplete, with a retry. This includes malformed JSON lines:
  preserve valid repository events before the malformed line, even within the same
  received chunk, and show the incomplete-results/retry message rather than a raw
  parser error. A malformed stream before any results also allows a retry.
  When the page disconnects, even while
  repositories are still being listed, no further repositories are started.
- Use the existing repository discovery, copy grouping, metadata, source, and
  commit-pinned links. Display repository headings (including repositories with zero skills),
  per-repository counts and commits, a total skill count, and the selected skill's
  repository. Selecting a skill never refetches its contents.
- The skill filter applies across all repositories. While filtering, show only
  repository headings that have matching skills; counts cover the organization total.
- A failed repository is skipped with a repository-specific warning; other
  repositories still appear, including when a response body fails while being read.
  Unexpected per-repository errors use a generic warning without internal details.
  Failure on a later listing page retains earlier
  repositories with an explicit incomplete-listing warning. All discovery and
  skill warnings include their repository. Partial results are explicitly labeled
  as possibly incomplete. A missing organization, rejected token, rate limit, or
  failure on the first listing page is an error that allows a retry.
- An organization with no repositories or no skills is a successful empty state.
  Disable both the input and mode selector while scanning; clear earlier results,
  announce organization loading/status, and allow switching back to repository
  mode. Organization controls and selection work with a keyboard on narrow screens.
- Tokens stay on the server, including authenticated source reads. No organization
  or repository text is interpreted as HTML. Ambiguous API requests specifying
  both repository and organization inputs are rejected.

Organization acceptance coverage is in `tests/organization.test.ts` and
`tests/web-browser.test.ts`, using recorded GitHub responses.
