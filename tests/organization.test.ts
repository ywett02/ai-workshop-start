import assert from 'node:assert/strict';
import { test } from 'node:test';
import { organizationFixture, organizationRecording, ORG, orgUrl, pageUrl, PATH } from './organization-helpers.ts';
import { API, githubRecording, rawUrl } from './scenarios.ts';
import { EXAMPLE_COMMIT } from './helpers.ts';
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const result = await (await fetch(`http://127.0.0.1:${address.port}/api/scan?organization=${ORG}`)).json() as OrganizationResult;
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
    if (String(input) === `${API}/repos/${ORG}/alpha`) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"full_name":'));
          controller.error(new TypeError('terminated: private transport details'));
        },
      }), { status: 200 });
    }
    return recordedFetch(input, init);
  } } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/scan?organization=${ORG}`);
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
