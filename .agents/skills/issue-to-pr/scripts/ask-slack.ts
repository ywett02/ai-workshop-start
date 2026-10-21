// Posts a question to the #ikvl Slack channel and waits for the first human reply in its thread.
// Prints the reply text and exits 0; exits 2 if nobody answers before the timeout.
// Usage: SLACK_BOT_TOKEN=... node .agents/skills/issue-to-pr/scripts/ask-slack.ts <question> [timeout-minutes]
const [question, timeoutMinutes = '60'] = process.argv.slice(2);
const token = process.env.SLACK_BOT_TOKEN;
if (!question) throw new Error('Usage: ask-slack.ts <question> [timeout-minutes]');
if (!token) throw new Error('SLACK_BOT_TOKEN is not set');
const api = process.env.SLACK_API_URL ?? 'https://slack.com/api';
const channel = process.env.SLACK_CHANNEL ?? 'ikvl';
const pollMs = Number(process.env.SLACK_POLL_SECONDS ?? 30) * 1000;

async function slack(method: string, params: Record<string, string>) {
  const response = await fetch(`${api}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await response.json();
  if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error}`);
  return body;
}

const posted = await slack('chat.postMessage', { channel, text: question });
console.log(`asked in #${channel}: ts=${posted.ts}; waiting for a reply in the thread`);

const deadline = Date.now() + Number(timeoutMinutes) * 60_000;
while (Date.now() < deadline) {
  await new Promise((done) => setTimeout(done, pollMs));
  const { messages } = await slack('conversations.replies', { channel: posted.channel, ts: posted.ts });
  const replies = messages.filter((message: { ts: string; bot_id?: string }) => message.ts !== posted.ts && !message.bot_id);
  if (replies.length) {
    console.log(replies.map((reply: { user: string; text: string }) => `<@${reply.user}>: ${reply.text}`).join('\n'));
    process.exit(0);
  }
}
console.log(`no reply after ${timeoutMinutes} minutes`);
process.exit(2);
