# Slack questions for issue-to-pr

The issue-to-pr skill's `ask-slack.ts` helper posts one question and waits for a
human answer in that message's Slack thread. Run it with Node 24:

```console
node .agents/skills/issue-to-pr/scripts/ask-slack.ts <question> [timeout-minutes]
```

- A question and `SLACK_BOT_TOKEN` are required. Missing input or credentials
  fails before making any request. Invalid, nonpositive or nonfinite timeout and
  polling values also fail before posting.
- Post the question once to `chat.postMessage` using bearer authentication and
  form encoding. Default to channel `ikvl`; `SLACK_CHANNEL` overrides it.
  `SLACK_API_URL` overrides the API base URL (default `https://slack.com/api`).
- Poll `conversations.replies` using the channel and timestamp returned by the
  post. Default to 30 seconds between polls; `SLACK_POLL_SECONDS` overrides it.
  Ignore the original question, bot messages, and messages without a user.
  On the first poll containing human answers, print each as `<@user>: text`
  and exit 0. If there are only ignored messages, continue polling.
- The reply deadline starts after the post succeeds and defaults to 60 minutes.
  Bound sleeps and reply requests, including reading the response body, by the
  remaining time. Do not accept answers at or after the deadline. No answer,
  delayed headers, or a stalled response body must print `no reply after <timeout>
  minutes` and exit 2 when the deadline expires, without an unhandled error.
- Slack API failures (including `not_in_channel` and `missing_scope`), HTTP
  failures and malformed JSON fail with a nonzero status other than 2 and an
  error on stderr. A reply API error before the deadline is an error, not a
  missing answer.

Integration coverage in `tests/slack-questions.test.ts` launches the actual
helper against a local HTTP mock. It never posts to real Slack.
