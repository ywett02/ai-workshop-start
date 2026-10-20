import assert from 'node:assert/strict';
import { test } from 'node:test';
import { organizationFixture, organizationRecording, ORG, orgUrl, pageUrl, PATH } from './organization-helpers.ts';
import { API, githubRecording, rawUrl } from './scenarios.ts';
import { EXAMPLE_COMMIT } from './helpers.ts';
import { listen } from './web-helpers.ts';
import type { ScanResult } from '../src/core/scan.ts';
import type { Skill } from '../src/core/model.ts';

type WebRepository = Omit<ScanResult, 'skills'> & { skills: (Skill & { link: string; content: string })[] };
type OrganizationResult = { organization: string; repositoryCount: number; repositories: WebRepository[]; skills: WebRepository['skills']; warnings: string[] };

test('organization HTTP scan preserves repositories, independent identities, pinned sources and partial warnings', async (t) => {
  const app = await organizationFixture(organizationRecording(), 'server-secret');
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=https://github.com/${ORG}/`);
  assert.equal(response.status, 200);
  const result = await response.json() as OrganizationResult;
  assert.equal(result.organization, ORG);
  assert.equal(result.repositoryCount, 4);
  assert.deepEqual(result.repositories.map((r) => r.repository.id), ['Example/alpha', 'Example/empty', 'Example/zeta']);
  assert.deepEqual(result.skills.map((s) => s.id), [`Example/alpha:${PATH}`, `Example/zeta:${PATH}`]);
  assert.equal(result.skills[0].commit, EXAMPLE_COMMIT);
  assert.equal(result.skills[0].link, `https://github.com/Example/alpha/blob/${EXAMPLE_COMMIT}/${PATH}`);
  assert.match(result.skills[0].content, /window.pwned/);
  assert.match(result.warnings.join('\n'), /Example\/broken:.*Repository not found/);
  assert.equal(JSON.stringify(result).includes('server-secret'), false);
  assert.equal(app.calls.filter((c) => c.url === rawUrl('Example/alpha', PATH)).length, 1);
  for (const call of app.calls) assert.equal(call.headers?.Authorization, 'Bearer server-secret');
  // Code search allows ten requests a minute; the listing already names each default branch.
  assert.deepEqual(app.calls.filter((c) => c.url.includes('/search/') || /\/repos\/[^/]+\/[^/]+$/.test(c.url)), []);
});

test('organization scan follows all pages, deduplicates, and keeps alphabetical repository order', async (t) => {
  const recording = organizationRecording();
  const names = Array.from({ length: 100 }, (_, i) => `repo-${String(i).padStart(3, '0')}`);
  recording[pageUrl()] = { status: 200, body: names.map((name) => ({ full_name: `${ORG}/${name}` })) };
  recording[pageUrl(2)] = { status: 200, body: [{ full_name: `${ORG}/repo-000` }, { full_name: `${ORG}/zeta` }] };
  for (const name of names) Object.assign(recording, githubRecording(`${ORG}/${name}`, {}));
  const app = await organizationFixture(recording);
  t.after(app.close);
  const result = await (await fetch(`${app.url}/api/scan?organization=${ORG}`)).json() as OrganizationResult;
  assert.equal(result.repositoryCount, 101);
  assert.equal(result.repositories.length, 101);
  assert.equal(result.repositories.at(-1)!.repository.id, `${ORG}/zeta`);
  assert.equal(app.calls.filter((c) => c.url === `${API}/repos/${ORG}/repo-000`).length, 1);
});

test('later listing failure returns earlier repositories with an explicit incomplete warning', async (t) => {
  const recording = organizationRecording();
  recording[pageUrl()] = { status: 200, body: Array.from({ length: 100 }, () => ({ full_name: `${ORG}/alpha` })) };
  recording[pageUrl(2)] = { status: 403, body: { message: 'API rate limit exceeded' } };
  const app = await organizationFixture(recording);
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=${ORG}`);
  assert.equal(response.status, 200);
  const result = await response.json() as OrganizationResult;
  assert.equal(result.skills.length, 1);
  assert.match(result.warnings.join('\n'), /incomplete.*may omit.*rate limit/i);
});

for (const [status, message, expected] of [
  [404, 'Not Found', /Organization not found/],
  [401, 'Bad credentials', /rejected the token/],
  [403, 'API rate limit exceeded', /rate limit/],
] as const) test(`organization lookup failure ${status} is retryable`, async (t) => {
  const recording = organizationRecording();
  recording[orgUrl] = { status, body: { message } };
  const app = await organizationFixture(recording);
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=${ORG}`);
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error, expected);
});

test('organization first-page failure is an error, empty organizations and skill-free repositories succeed', async (t) => {
  for (const body of [[], [{ full_name: `${ORG}/empty` }]]) {
    const recording = organizationRecording();
    recording[pageUrl()] = { status: 200, body };
    const app = await organizationFixture(recording);
    t.after(app.close);
    const response = await fetch(`${app.url}/api/scan?organization=github.com/${ORG}`);
    assert.equal(response.status, 200);
    const result = await response.json() as OrganizationResult;
    assert.deepEqual(result.skills, []);
    assert.equal(result.repositoryCount, body.length);
  }
  const recording = organizationRecording();
  recording[pageUrl()] = { status: 500, body: { message: 'Unavailable' } };
  const app = await organizationFixture(recording);
  t.after(app.close);
  assert.equal((await fetch(`${app.url}/api/scan?organization=${ORG}`)).status, 502);
});

test('organization API rejects unsafe, malformed and ambiguous inputs before accessing GitHub', async (t) => {
  const app = await organizationFixture();
  t.after(app.close);
  for (const input of ['', '/etc/passwd', '../Example', '-Example', 'Example-', 'Example--org', 'A'.repeat(40), 'https://evil.com/Example', 'https://github.com/Example/repo', 'Example?x=1']) {
    assert.equal((await fetch(`${app.url}/api/scan?organization=${encodeURIComponent(input)}`)).status, 400, input);
  }
  assert.equal((await fetch(`${app.url}/api/scan?organization=Example&repository=github.com/Example/repo`)).status, 400);
  assert.equal(app.calls.length, 0);
});

test('organization scan reuses copy rules, skill ordering and repository-specific warnings', async (t) => {
  const recording = organizationRecording();
  Object.assign(recording, githubRecording(`${ORG}/alpha`, {
    [PATH]: '---\nname: Zulu\ndescription: Canonical\n---\nSource',
    '.claude/skills/check/SKILL.md': 'Conflicting copy without metadata',
    '.agents/skills/first/SKILL.md': '---\nname: Alpha\n---\nFirst',
    '.agents/skills/broken/SKILL.md': 'No front matter',
    'product/skills/ignored/SKILL.md': 'Excluded',
  }));
  const app = await organizationFixture(recording);
  t.after(app.close);
  const result = await (await fetch(`${app.url}/api/scan?organization=${ORG}`)).json() as OrganizationResult;
  assert.deepEqual(result.repositories[0].skills.map((s) => s.name), ['Alpha', 'Zulu', 'broken']);
  const canonical = result.skills.find((s) => s.name === 'Zulu')!;
  assert.deepEqual(canonical.copies, ['.claude/skills/check/SKILL.md']);
  assert.equal(canonical.description, 'Canonical');
  assert.match(result.warnings.join('\n'), /Example\/alpha: .*conflicting copy/);
  assert.match(result.warnings.join('\n'), /Example\/alpha: .*front matter/);
});

test('organization HTTP scan bounds concurrent repository work and restores order after out-of-order completion', async (t) => {
  const { createWebServer } = await import('../src/server.ts');
  const { replay } = await import('../src/core/replay.ts');
  const recording = organizationRecording();
  const names = Array.from({ length: 9 }, (_, i) => `${ORG}/repo-${i}`);
  recording[pageUrl()] = { status: 200, body: names.map((full_name) => ({ full_name })) };
  let active = 0;
  let maximum = 0;
  const completed: string[] = [];
  const server = createWebServer({ github: { fetch: replay(recording) }, open: async (input) => {
    const id = input.slice('https://github.com/'.length);
    maximum = Math.max(maximum, ++active);
    await new Promise((resolve) => setTimeout(resolve, id.endsWith('0') ? 40 : 1));
    active--;
    completed.push(id);
    return { repository: { id, organization: ORG, name: id.split('/')[1], url: input, commit: EXAMPLE_COMMIT }, paths: [], warnings: [], read: async () => undefined };
  } });
  const app = await listen(server);
  t.after(app.close);
  const result = await (await fetch(`${app.url}/api/scan?organization=${ORG}`)).json() as OrganizationResult;
  assert.equal(maximum, 4);
  assert.notEqual(completed[0], names[0]);
  assert.deepEqual(result.repositories.map((r) => r.repository.id), names);
});


test('organization HTTP scan preserves healthy repositories when a response body terminates', async (t) => {
  const { createWebServer } = await import('../src/server.ts');
  const { replay } = await import('../src/core/replay.ts');
  const recording = organizationRecording();
  recording[pageUrl()] = { status: 200, body: [
    { full_name: `${ORG}/alpha` }, { full_name: `${ORG}/zeta` },
  ] };
  const recordedFetch = replay(recording);
  const server = createWebServer({ github: { fetch: async (input, init) => {
    if (String(input) === `${API}/repos/${ORG}/alpha/commits/main`) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"full_name":'));
          controller.error(new TypeError('terminated: private transport details'));
        },
      }), { status: 200 });
    }
    return recordedFetch(input, init);
  } } });
  const app = await listen(server);
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=${ORG}`);
  assert.equal(response.status, 200);
  const result = await response.json() as OrganizationResult;
  assert.equal(result.repositoryCount, 2);
  assert.deepEqual(result.repositories.map((r) => r.repository.id), [`${ORG}/zeta`]);
  assert.deepEqual(result.skills.map((s) => s.id), [`${ORG}/zeta:${PATH}`]);
  assert.ok(result.skills[0].content);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Example\/alpha: Unable to scan repository.*skipped; results may omit project skills/);
  assert.equal(JSON.stringify(result).includes('private transport details'), false);
});

test('organization stream reports each repository as soon as it is scanned, then the end', async (t) => {
  const { createWebServer } = await import('../src/server.ts');
  const { replay } = await import('../src/core/replay.ts');
  const recording = organizationRecording();
  const recorded = replay(recording);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  // alpha is held back, so the other repositories must arrive first.
  const app = await listen(createWebServer({ github: { fetch: async (url, init) => {
    if (url === `${API}/repos/${ORG}/alpha/commits/main`) await gate;
    return recorded(url, init);
  } } }));
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=${ORG}`, { headers: { Accept: 'application/x-ndjson' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/);
  const events: { type: string; id?: string; result?: WebRepository; warnings?: string[]; repositoryCount?: number }[] = [];
  let buffered = '';
  for await (const chunk of response.body!.pipeThrough(new TextDecoderStream())) {
    const lines = (buffered + chunk).split('\n');
    buffered = lines.pop()!;
    events.push(...lines.map((line) => JSON.parse(line)));
    if (events.filter((e) => e.type === 'repository').length === 3) release();
  }
  assert.deepEqual(events.map((e) => e.type), ['start', 'repository', 'repository', 'repository', 'repository', 'done']);
  assert.equal(events[0].repositoryCount, 4);
  assert.equal(events.at(-2)!.id, `${ORG}/alpha`);
  assert.equal(events.at(-2)!.result!.skills[0].id, `${ORG}/alpha:${PATH}`);
  assert.match(events.find((e) => e.id === `${ORG}/broken`)!.warnings!.join(), /Example\/broken:.*Repository not found.*skipped/);
});

test('organization stream reports a missing organization as an ordinary retryable error', async (t) => {
  const recording = organizationRecording();
  recording[orgUrl] = { status: 404, body: { message: 'Not Found' } };
  const app = await organizationFixture(recording);
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=${ORG}`, { headers: { Accept: 'application/x-ndjson' } });
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error, /Organization not found/);
});

test('organization stream starts no repository scans for a page that left during the listing', async (t) => {
  const { createWebServer } = await import('../src/server.ts');
  const { replay } = await import('../src/core/replay.ts');
  const { get } = await import('node:http');
  const recorded = replay(organizationRecording());
  let listing!: () => void;
  const listed = new Promise<void>((resolve) => { listing = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const opened: string[] = [];
  const server = createWebServer({
    github: { fetch: async (url, init) => {
      if (url === pageUrl()) {
        listing();
        await gate;
      }
      return recorded(url, init);
    } },
    open: async (input) => {
      opened.push(input);
      throw new Error('not scanned');
    },
  });
  const app = await listen(server);
  t.after(app.close);
  const request = get(`${app.url}/api/scan?organization=${ORG}`, { headers: { Accept: 'application/x-ndjson' } });
  request.on('error', () => {});
  await listed;
  request.destroy();
  while (await new Promise<number>((resolve, reject) => server.getConnections((error, count) => error ? reject(error) : resolve(count)))) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(opened, []);
});
