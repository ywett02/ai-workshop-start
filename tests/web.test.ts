import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMIT, CONTENT, FILES, webFixture } from './web-helpers.ts';
import type { ScanResult } from '../src/core/scan.ts';
import type { Skill } from '../src/core/model.ts';

type WebResult = Omit<ScanResult, 'skills'> & { skills: (Skill & { content: string; link: string })[] };

test('web API reuses project discovery and returns canonical source from the scanned commit', async (t) => {
  const app = await webFixture();
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?repository=https://github.com/Test/skills`);
  assert.equal(response.status, 200);
  const result = await response.json() as WebResult;
  assert.deepEqual(result.skills.map((skill: { name: string }) => skill.name), ['Alpha', 'Beta', 'z-broken']);
  assert.equal(result.repository.commit, COMMIT);
  assert.equal(result.skills[0].content, CONTENT);
  assert.equal(result.skills[0].description, 'First skill. Full description.');
  assert.deepEqual(result.skills[0].copies, ['.claude/skills/alpha/SKILL.md']);
  assert.equal(result.skills[0].link, `https://github.com/Test/skills/blob/${COMMIT}/.agents/skills/alpha/SKILL.md`);
  assert.equal(result.skills[2].content, FILES['agent/skills/z-broken/SKILL.md']);
  assert.match(result.warnings.join('\n'), /incomplete.*may omit/);
  assert.match(result.warnings.join('\n'), /conflicting copy/);
  assert.match(result.warnings.join('\n'), /front matter/);
  assert.match(result.warnings.join('\n'), /unreadable/);
  assert.equal(app.reads.length, 5);
  assert.equal(new Set(app.reads).size, app.reads.length, 'contents are not fetched again');
});

test('web API rejects invalid inputs and preserves safe, useful failure messages', async (t) => {
  const app = await webFixture();
  t.after(app.close);
  for (const input of ['', '/etc/passwd', 'https://example.com/Test/skills']) {
    const response = await fetch(`${app.url}/api/scan?repository=${encodeURIComponent(input)}`);
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /GitHub repository URL/);
  }
  assert.equal(app.reads.length, 0);
  const missing = await fetch(`${app.url}/api/scan?repository=github.com/Test/missing`);
  assert.equal(missing.status, 502);
  assert.match((await missing.json() as { error: string }).error, /Repository not found/);
  const failure = await fetch(`${app.url}/api/scan?repository=github.com/Test/failure`);
  assert.equal(failure.status, 500);
  assert.doesNotMatch(JSON.stringify(await failure.json()), /internal secret/);
  const empty = await fetch(`${app.url}/api/scan?repository=github.com/Test/empty`);
  assert.equal(empty.status, 200);
  assert.deepEqual((await empty.json() as WebResult).skills, []);
});

test('local server serves only web assets with restrictive headers and GET methods', async (t) => {
  const app = await webFixture();
  t.after(app.close);
  for (const [path, contentType] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/style.css', 'text/css']]) {
    const response = await fetch(`${app.url}${path}`);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type')?.startsWith(contentType));
    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.text()).length);
  }
  for (const path of ['/package.json', '/src/server.ts', '/%2e%2e/package.json']) {
    assert.equal((await fetch(`${app.url}${path}`)).status, 404);
  }
  const post = await fetch(`${app.url}/api/scan?repository=github.com/Test/skills`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
});
