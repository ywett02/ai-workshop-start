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
const timeoutMs = Number(timeoutMinutes) * 60_000;
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeout-minutes must be finite and positive');
if (!Number.isFinite(pollMs) || pollMs <= 0) throw new Error('SLACK_POLL_SECONDS must be finite and positive');

type SlackMessage = { ts: string; bot_id?: string; subtype?: string; user?: string; text: string };
type SlackResponse = { ok: boolean; error?: string; channel: string; ts: string; messages: SlackMessage[] };

async function slack(method: string, params: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(`${api}/${method}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal,
  });
  if (!response.ok) throw new Error(`Slack ${method} failed: HTTP ${response.status}`);
  const body = await response.json() as SlackResponse;
  if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error}`);
  return body;
}

const posted = await slack('chat.postMessage', { channel, text: question });
console.log(`asked in #${channel}: ts=${posted.ts}; waiting for a reply in the thread`);

const deadline = performance.now() + timeoutMs;
while (performance.now() < deadline) {
  // Node timers cannot exceed a signed 32-bit delay. Longer waits use another iteration.
  const remainingBeforeSleep = deadline - performance.now();
  const waitMs = Math.min(pollMs, 2 ** 31 - 1);
  await new Promise((done) => setTimeout(done, Math.ceil(Math.min(waitMs, remainingBeforeSleep))));
  if (waitMs >= remainingBeforeSleep) continue;
  const remaining = deadline - performance.now();
  if (remaining <= 0) break;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.ceil(remaining), 2 ** 31 - 1));
  try {
    const { messages } = await slack('conversations.replies', { channel: posted.channel, ts: posted.ts }, controller.signal);
    if (controller.signal.aborted || performance.now() >= deadline) break;
    const replies = messages.filter((message) =>
      message.ts !== posted.ts && !message.bot_id && message.subtype !== 'bot_message' && message.user);
    if (replies.length) {
      console.log(replies.map((reply) => `<@${reply.user}>: ${reply.text}`).join('\n'));
      process.exit(0);
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    if (performance.now() >= deadline) break;
  } finally {
    clearTimeout(timer);
  }
}
console.log(`no reply after ${timeoutMinutes} minutes`);
process.exit(2);
