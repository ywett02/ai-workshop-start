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
- Show the source as plain text, with line wrapping and scrolling. Repository
  HTML and scripts must remain inert. Never inject repository text as HTML.
- Display all scan warnings, including malformed metadata, conflicting copies,
  unreadable occurrences, and incomplete discovery. An incomplete result is not
  presented as exhaustive.
- Show explicit initial, empty, and error states. A repository with no skills is
  a successful result. Show useful GitHub failure messages and allow retries.
- Keep the interface usable on narrow screens and with a keyboard. Label the
  input, announce scan status, expose the selected skill, and show focus outlines.
- Use `GITHUB_TOKEN` on the server if set; never send it to the browser. Store
  nothing on disk or in browser storage. Serve only explicitly listed assets;
  API inputs cannot request arbitrary local files. Accept only GET requests.

HTTP integration coverage lives in `tests/web.test.ts`. Browser acceptance
coverage lives in `tests/web-browser.test.ts` and runs through `npm test`, using
recorded/local sources rather than live GitHub contents.
