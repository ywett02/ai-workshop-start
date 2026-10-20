// Run the real command/core pipeline against recorded API answers; never live GitHub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { skillLink } from '../src/core/model.ts';
import { replay } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { EXAMPLE_COMMIT } from './helpers.ts';
import { API, githubRecording, rawUrl, scanGitHub, searchUrl, skill, type GitTree } from './scenarios.ts';

const id = 'JetBrains/project';
const canonical = '.agents/skills/check/SKILL.md';
const copy = '.claude/skills/check/SKILL.md';
const good = '.github/skills/good/SKILL.md';
const pinnedLink = (path: string) => `https://github.com/${id}/blob/${EXAMPLE_COMMIT}/${path.split('/').map(encodeURIComponent).join('/')}`;
const incompleteWarning = /incomplete|partial|truncat|may (?:omit|miss)|not exhaustive/i;

for (const token of [undefined, 'test-token']) {
  const method = token ? 'authenticated search' : 'unauthenticated tree';

  test(`${method}: project roots, copies, Android workflow, product resources, and test data`, async () => {
    const android = 'agent/skills/writing-lint-checks/SKILL.md';
    const recording = githubRecording(id, {
      [copy]: skill(),
      [canonical]: skill(),
      [android]: skill('writing-lint-checks'),
      'plugins/mcp-tools/resources/bundled/skills/mps-aspect-generator/SKILL.md': skill('product'),
      'integration-tests/src/jvmTest/resources/skills/weather-retrieval/SKILL.md': '---\nname: [broken\n---\n',
    });
    assert.deepEqual(await scanGitHub(id, recording, token), {
      code: 0,
      stdout: [
        `${id} · 2 skills`,
        'check — Check the project.', `  ${pinnedLink(canonical)}`, `  also in ${copy}`,
        'writing-lint-checks — Check the project.', `  ${pinnedLink(android)}`,
      ].join('\n'),
      stderr: '',
    });
  });

  test(`${method}: symlink entry points are excluded at the scanned commit`, async () => {
    const linked = '.agents/skills/linked/SKILL.md';
    const recording = githubRecording(id, {
      [linked]: '../../../instructions.md', [good]: skill('good'),
    }, { [linked]: '120000' });
    assert.deepEqual(await scanGitHub(id, recording, token), {
      code: 0, stdout: `${id} · 1 skill\ngood — Check the project.\n  ${pinnedLink(good)}`, stderr: '',
    });
  });
}

for (const status of [404, 403, 500]) {
  test(`HTTP ${status} reading a copy: warn, promote the next readable copy, and continue`, async () => {
    const recording = githubRecording(id, {
      [canonical]: { status, body: 'Cannot read this file' },
      [copy]: skill(),
      [good]: skill('good'),
    });
    const result = await scanGitHub(id, recording);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, [
      `${id} · 2 skills`, 'check — Check the project.', `  ${pinnedLink(copy)}`,
      'good — Check the project.', `  ${pinnedLink(good)}`,
    ].join('\n'));
    assert.match(result.stderr, /^warning: /);
    assert.ok(result.stderr.includes(canonical), result.stderr);
    assert.doesNotMatch(result.stdout, /also in/);
  });
}

test('a per-file network failure warns and skips only that occurrence', async () => {
  const recording = githubRecording(id, { [canonical]: skill(), [copy]: skill(), [good]: skill('good') });
  const recorded = replay(recording);
  const result = await scanGitHub(id, recording, undefined, (url, init) => {
    if (url === rawUrl(id, canonical)) return Promise.reject(new Error('connection reset while reading skill'));
    return recorded(url, init);
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    `${id} · 2 skills`, 'check — Check the project.', `  ${pinnedLink(copy)}`,
    'good — Check the project.', `  ${pinnedLink(good)}`,
  ].join('\n'));
  assert.match(result.stderr, /^warning: /);
  assert.ok(result.stderr.includes(canonical), result.stderr);
});

test('all occurrences unreadable: warn for each path and succeed with zero skills', async () => {
  const recording = githubRecording(id, {
    [canonical]: { status: 404, body: 'Not Found' }, [copy]: { status: 404, body: 'Not Found' },
  });
  const result = await scanGitHub(id, recording);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${id} · 0 skills`);
  assert.ok(result.stderr.includes(canonical), result.stderr);
  assert.ok(result.stderr.includes(copy), result.stderr);
  assert.equal(result.stderr.split('\n').filter((line) => line.startsWith('warning: ')).length, 2);
});

test('the canonical ID, metadata, commit, and remaining copies follow readability', async () => {
  const remaining = '.github/skills/check/SKILL.md';
  const recording = githubRecording(id, {
    [canonical]: { status: 404, body: 'Not Found' }, [remaining]: skill('display'), [copy]: skill('display'),
  });
  const result = await scan(await openGitHub(`https://github.com/${id}`, { fetch: replay(recording) }));
  assert.deepEqual(result.skills, [{
    id: `${id}:${copy}`, repository: id, path: copy, name: 'display',
    description: 'Check the project. Run before committing.', commit: EXAMPLE_COMMIT, copies: [remaining],
  }]);
  assert.equal(skillLink(result.repository, result.skills[0]), pinnedLink(copy));
  assert.ok(result.warnings.some((warning) => warning.includes(canonical)));
});

test('identical directory names and contents in different repositories retain separate identities', async () => {
  const results = await Promise.all(['JetBrains/first', 'JetBrains/second'].map(async (repository) => {
    const recording = githubRecording(repository, { [canonical]: skill() });
    return scan(await openGitHub(`https://github.com/${repository}`, { fetch: replay(recording) }));
  }));
  assert.deepEqual(results.map((result) => result.skills.map((skill) => skill.id)), [
    [`JetBrains/first:${canonical}`], [`JetBrains/second:${canonical}`],
  ]);
  for (const result of results) assert.deepEqual(result.skills[0].copies, []);
});

test('GitHub links encode path segments and pin every read to the resolved commit', async () => {
  const path = '.agents/skills/lint checks #1/SKILL.md';
  const recording = githubRecording(id, { [path]: skill('lint') });
  const recorded = replay(recording);
  const rawRequests: string[] = [];
  const result = await scanGitHub(id, recording, undefined, (url, init) => {
    if (url.startsWith('https://raw.githubusercontent.com/')) rawRequests.push(url);
    return recorded(url, init);
  });
  assert.deepEqual(result, {
    code: 0, stdout: `${id} · 1 skill\nlint — Check the project.\n  ${pinnedLink(path)}`, stderr: '',
  });
  assert.deepEqual(rawRequests, [rawUrl(id, path)]);
});

test('truncated root listing falls back to project roots and explicitly warns about limited discovery', async () => {
  const recording = githubRecording(id, { [canonical]: skill(), [good]: skill('good') });
  recording[`${API}/repos/${id}/git/trees/${EXAMPLE_COMMIT}?recursive=1`] = {
    status: 200, body: { truncated: true, tree: [] },
  };
  const result = await scanGitHub(id, recording);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, [
    `${id} · 2 skills`, 'check — Check the project.', `  ${pinnedLink(canonical)}`,
    'good — Check the project.', `  ${pinnedLink(good)}`,
  ].join('\n'));
  assert.match(result.stderr, /^warning: /);
  assert.match(result.stderr, /incomplete|partial|truncat|may (?:omit|miss)|not exhaustive|looked only/i);
});

test('a truncated skill-root subtree also produces an explicit incompleteness warning', async () => {
  const recording = githubRecording(id, { [canonical]: skill() });
  recording[`${API}/repos/${id}/git/trees/${EXAMPLE_COMMIT}?recursive=1`] = {
    status: 200, body: { truncated: true, tree: [] },
  };
  const root = recording[`${API}/repos/${id}/git/trees/${EXAMPLE_COMMIT}`].body as GitTree;
  const agents = root.tree.find((entry) => entry.path === '.agents')!;
  const agentsTree = recording[`${API}/repos/${id}/git/trees/${agents.sha}`].body as GitTree;
  const skills = agentsTree.tree.find((entry) => entry.path === 'skills')!;
  for (const suffix of ['', '?recursive=1']) {
    const url = `${API}/repos/${id}/git/trees/${skills.sha}${suffix}`;
    const body = recording[url].body as GitTree;
    recording[url] = { status: 200, body: { ...body, truncated: true } };
  }
  const result = await scanGitHub(id, recording);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${id} · 1 skill\ncheck — Check the project.\n  ${pinnedLink(canonical)}`);
  assert.match(result.stderr, /^warning: /);
  assert.match(result.stderr, incompleteWarning);
});

test('GitHub search incomplete_results warns rather than silently presenting a complete scan', async () => {
  const recording = githubRecording(id, { [canonical]: skill() });
  recording[searchUrl(id)] = {
    status: 200,
    body: { total_count: 1, incomplete_results: true, items: [{ path: canonical }] },
  };
  const result = await scanGitHub(id, recording, 'test-token');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `${id} · 1 skill\ncheck — Check the project.\n  ${pinnedLink(canonical)}`);
  assert.match(result.stderr, /^warning: /);
  assert.match(result.stderr, incompleteWarning);
});

test('search at the 1,000-result cap either recovers all skills or warns about omitted results', async () => {
  const files = Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [
    `.agents/skills/check-${String(index).padStart(4, '0')}/SKILL.md`, skill(`check-${String(index).padStart(4, '0')}`),
  ]));
  const recording = githubRecording(id, files);
  const result = await scanGitHub(id, recording, 'test-token');
  assert.equal(result.code, 0, result.stderr);
  const header = result.stdout.split('\n')[0];
  assert.ok(header === `${id} · 1000 skills` || header === `${id} · 1001 skills`, header);
  if (header === `${id} · 1000 skills`) {
    assert.match(result.stderr, /^warning: /);
    assert.match(result.stderr, incompleteWarning);
  } else {
    assert.ok(result.stdout.includes('check-1000 — Check the project.'));
  }
});
