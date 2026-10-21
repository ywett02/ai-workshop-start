import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { test, type TestContext } from 'node:test';

const helper = '.agents/skills/issue-to-pr/scripts/ask-slack.ts';
const posted = { ok: true, channel: 'C1', ts: '1' };
const answer = { ts: '2', user: 'U1', text: 'answer' };
const json = (res: ServerResponse, body: unknown) => res.end(JSON.stringify(body));

async function mock(t: TestContext, handle: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function run(api: string, args = ['Question?', '0.01'], env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [helper, ...args], {
    env: { ...process.env, SLACK_BOT_TOKEN: 'mock', SLACK_CHANNEL: 'ikvl',
      SLACK_API_URL: api, SLACK_POLL_SECONDS: '0.005', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => { stdout += data; });
  child.stderr.on('data', (data) => { stderr += data; });
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (status, signal) => {
        if (signal) reject(new Error(`helper exceeded test deadline: ${signal}\n${stdout}\n${stderr}`));
        else resolve(status);
      });
    });
    return { code, stdout, stderr };
  } finally {
    clearTimeout(watchdog);
  }
}

test('Slack questions: authenticated form post, returned thread, filtering and human answers', async (t) => {
  const requests: { path: string; auth: string | undefined; contentType: string | undefined; params: URLSearchParams }[] = [];
  let polls = 0;
  const api = await mock(t, (req, res) => {
    let body = '';
    req.on('data', (data) => { body += data; });
    req.on('end', () => {
      assert.equal(req.method, 'POST');
      requests.push({ path: req.url!, auth: req.headers.authorization,
        contentType: req.headers['content-type'], params: new URLSearchParams(body) });
      if (req.url === '/chat.postMessage') json(res, posted);
      else {
        polls++;
        const ignored = [{ ts: '1', user: 'U0', text: 'Question?' },
          { ts: '3', bot_id: 'B1', user: 'UB', text: 'bot' },
          { ts: '4', subtype: 'bot_message', user: 'UB', text: 'bot subtype' },
          { ts: '5', text: 'system message' }];
        json(res, { ok: true, messages: [...ignored, ...(polls === 1 ? [] : [answer, { ts: '6', user: 'U2', text: 'second' }])] });
      }
    });
  });
  const result = await run(api, ['What & why?'], { SLACK_CHANNEL: 'custom' });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /<@U1>: answer\n<@U2>: second/);
  assert.doesNotMatch(result.stdout, /bot|system message|<@U0>/);
  assert.equal(polls, 2);
  assert.equal(requests[0]!.path, '/chat.postMessage');
  assert.deepEqual(Object.fromEntries(requests[0]!.params), { channel: 'custom', text: 'What & why?' });
  for (const request of requests) {
    assert.equal(request.auth, 'Bearer mock');
    assert.equal(request.contentType, 'application/x-www-form-urlencoded');
  }
  for (const request of requests.slice(1)) {
    assert.equal(request.path, '/conversations.replies');
    assert.deepEqual(Object.fromEntries(request.params), { channel: 'C1', ts: '1' });
  }
});

test('Slack questions: invalid input fails before posting', async (t) => {
  let requests = 0;
  const api = await mock(t, (_req, res) => { requests++; json(res, posted); });
  const cases = [
    { args: [], env: {}, error: /Usage:/ },
    { args: ['Question?'], env: { SLACK_BOT_TOKEN: '' }, error: /SLACK_BOT_TOKEN is not set/ },
    ...['0', '-1', 'NaN', 'Infinity'].map((value) => ({ args: ['Question?', value], env: {}, error: /timeout-minutes/ })),
    ...['0', '-1', 'NaN', 'Infinity'].map((value) => ({ args: ['Question?'], env: { SLACK_POLL_SECONDS: value }, error: /SLACK_POLL_SECONDS/ })),
  ];
  for (const item of cases) {
    const result = await run(api, item.args, item.env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, item.error);
  }
  assert.equal(requests, 0);
});

for (const phase of ['post', 'replies']) {
  for (const failure of ['not_in_channel', 'missing_scope', 'http', 'json']) {
    test(`Slack questions: ${phase} ${failure} is an error`, async (t) => {
      const api = await mock(t, (req, res) => {
        if (phase === 'replies' && req.url === '/chat.postMessage') return json(res, posted);
        if (failure === 'http') { res.statusCode = 503; res.end('unavailable'); }
        else if (failure === 'json') res.end('{');
        else json(res, { ok: false, error: failure });
      });
      const result = await run(api, ['Question?', '0.05']);
      assert.equal(result.code, 1);
      assert.match(result.stderr, failure === 'http' ? /503/ : failure === 'json' ? /JSON/ : new RegExp(failure));
      assert.doesNotMatch(result.stdout, /no reply/);
    });
  }
}

for (const mode of ['empty', 'sleep', 'late', 'headers', 'body']) {
  test(`Slack questions: deadline bounds ${mode}`, async (t) => {
    let polls = 0;
    let timer: NodeJS.Timeout | undefined;
    t.after(() => clearTimeout(timer));
    const api = await mock(t, (req, res) => {
      if (req.url === '/chat.postMessage') {
        let body = '';
        req.on('data', (data) => { body += data; });
        req.on('end', () => {
          assert.equal(new URLSearchParams(body).get('channel'), 'ikvl');
          json(res, posted);
        });
        return;
      }
      polls++;
      if (mode === 'late') timer = setTimeout(() => json(res, { ok: true, messages: [answer] }), 800);
      else if (mode === 'body') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); }
      else if (mode !== 'headers') json(res, { ok: true, messages: [] });
    });
    const start = performance.now();
    const result = await run(api, ['Question?', '0.005'], { SLACK_POLL_SECONDS: mode === 'sleep' ? undefined : '0.005' });
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stdout, /no reply after 0\.005 minutes/);
    assert.doesNotMatch(result.stdout, /<@U1>/);
    assert.equal(result.stderr, '');
    assert.ok(performance.now() - start < 2000, 'deadline must terminate promptly');
    if (mode === 'sleep') assert.equal(polls, 0, 'do not poll after the final bounded sleep');
    else assert.ok(polls > 0);
  });
}
