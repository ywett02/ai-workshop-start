---
name: status-update
description: Use when asked for a status update, changelog, or summary of merged pull requests and resolved issues in this repository since a given time and date, or to post one to Slack.
---

# Status update

List the pull requests merged and the issues resolved since a given time and date, and post the summary to Slack.

## 1. Pin down the start time

1. Take the time and date from the request. If it has no time, use 00:00. If it has no time zone, use the local one (`date +%z`).
2. Convert it to UTC ISO 8601, for example `2026-10-20T07:00:00Z`. Call it `<since>`.
3. If no date was given at all, ask the user; do not guess a period.

## 2. Collect

Raise `--limit` if a list returns exactly that many results.

```sh
gh pr list --state merged --search "merged:>=<since>" --limit 200 \
  --json number,title,url,author,mergedAt

gh issue list --state closed --search "closed:>=<since> reason:completed" --limit 200 \
  --json number,title,url,closedAt
```

- Resolved means closed as completed. Leave out issues closed as not planned or duplicate.
- Sort each list by its merge or close time, oldest first.
- Note which PR closed each issue (`gh pr view <number> --json closingIssuesReferences`) so the reader can match them.

## 3. Write the message

Use Slack `mrkdwn`, not Markdown: links are `<url|text>` and bold is `*text*`. Keep it short:

```
*Status update since <since, in the requested time zone>*

*Merged PRs (<count>)*
• <url|#<number>> <title> (<author login>)

*Resolved issues (<count>)*
• <url|#<number>> <title> (closed by #<pr>)
```

Write `None` under a heading with no entries. Escape `&`, `<`, and `>` in titles as `&amp;`, `&lt;`, and `&gt;`.

## 4. Post

Use exactly:

- Workspace: `aiworkshopatjetbrains.slack.com`
- Channel: `#ikvl`, ID `C0CB0V63J68` (always address it by this ID)
- Token: the `SLACK_BOT_TOKEN` environment variable

Write the message to a file in your scratch directory and send it with `chat.postMessage`, building the JSON with `jq` so quotes and newlines are escaped:

```sh
jq -n --rawfile text <scratch>/status.txt '{channel: "C0CB0V63J68", text: $text, unfurl_links: false}' |
  curl -sS https://slack.com/api/chat.postMessage \
    -H "Authorization: Bearer $SLACK_BOT_TOKEN" \
    -H 'Content-Type: application/json; charset=utf-8' \
    --data @-
```

The response must contain `"ok": true`. If it does not, or `SLACK_BOT_TOKEN` is unset, do not retry with another channel or token; show the user the message and the error.

## Done when

- The message lists every PR merged and every issue resolved since `<since>`, and nothing earlier.
- It is posted once to `C0CB0V63J68` and Slack answered `"ok": true`.
- You reply with the counts, the period covered, and the message's permalink (`chat.getPermalink` with the returned `channel` and `ts`).
