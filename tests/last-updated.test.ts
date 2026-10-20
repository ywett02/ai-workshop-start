import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { createWebServer } from '../src/server.ts';
import { openGitHub } from '../src/core/github.ts';
import { scan, type ScanResult } from '../src/core/scan.ts';
import type { Skill } from '../src/core/model.ts';
import { replay, type Recorded, type Recording } from '../src/core/replay.ts';
import { EXAMPLE_COMMIT } from './helpers.ts';
import { githubRecording, rawUrl, skill } from './scenarios.ts';
import { listen } from './web-helpers.ts';

type WebResult = Omit<ScanResult, 'skills'> & {
  skills: (Skill & { lastUpdated: string | null; content: string })[];
  repositories: WebResult[];
};

const ID = 'Test/history';
const PATH = '.agents/skills/check & verify/SKILL.md';
const COPY = '.claude/skills/check & verify/SKILL.md';
const OTHER = '.agents/skills/other/SKILL.md';
const DATE = '2025-03-12T14:30:00Z';
const ISO = '2025-03-12T14:30:00.000Z';
const historyUrl = (path: string) => `https://api.github.com/repos/${ID}/commits?sha=${EXAMPLE_COMMIT}&path=${encodeURIComponent(path)}&per_page=1`;
function recording(): Recording {
  return {
    ...githubRecording(ID, { [PATH]: skill('Check', 'Verify commands.'), [COPY]: skill('Copy'), [OTHER]: skill('Other', 'Run other commands.') }),
    [historyUrl(PATH)]: { status: 200, body: [{ commit: { author: { date: '2000-01-01T00:00:00Z' }, committer: { date: DATE } } }] },
    [historyUrl(OTHER)]: { status: 200, body: [] },
  };
}
async function fixture(answers = recording()) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const recorded = replay(answers);
  const github = { token: 'server-only-secret', fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, headers: init?.headers });
    return recorded(url, init);
  } };
  return { ...await listen(createWebServer({ github })), calls, github };
}

test('web history is canonical, commit-pinned, encoded, authenticated and absent from CLI scans', async (t) => {
  const app = await fixture();
  t.after(app.close);
  await scan(await openGitHub(`https://github.com/${ID}`, app.github));
  assert.equal(app.calls.filter(({ url }) => url.includes('/commits?')).length, 0);
  const response = await fetch(`${app.url}/api/scan?repository=github.com/${ID}`);
  assert.equal(response.status, 200);
  const result = await response.json() as WebResult;
  assert.equal(result.skills[0].lastUpdated, ISO);
  assert.equal(result.skills[0].path, PATH);
  assert.equal(result.skills[1].lastUpdated, null);
  assert.match(result.warnings.join('\n'), /other\/SKILL.md: last updated date unavailable/);
  const calls = app.calls.filter(({ url }) => url.includes('/commits?'));
  assert.deepEqual(calls.map(({ url }) => url).sort(), [historyUrl(PATH), historyUrl(OTHER)].sort());
  assert.ok(calls.every(({ headers }) => headers?.Authorization === 'Bearer server-only-secret'));
  assert.doesNotMatch(JSON.stringify(result), /server-only-secret/);
});

test('history follows the readable canonical occurrence when the first copy cannot be read', async (t) => {
  const answers = recording();
  answers[rawUrl(ID, PATH)] = { status: 404, body: 'Not Found' };
  answers[historyUrl(COPY)] = answers[historyUrl(PATH)];
  const app = await fixture(answers);
  t.after(app.close);
  const result = await (await fetch(`${app.url}/api/scan?repository=github.com/${ID}`)).json() as WebResult;
  assert.equal(result.skills[0].path, COPY);
  assert.equal(result.skills[0].lastUpdated, ISO);
  assert.equal(app.calls.some(({ url }) => url === historyUrl(PATH)), false);
});

const failures: Record<string, Recorded> = {
  empty: { status: 200, body: [] },
  malformed: { status: 200, body: { unexpected: true } },
  missing: { status: 200, body: [{ commit: { committer: null } }] },
  invalid: { status: 200, body: [{ commit: { committer: { date: '<script>unsafe</script>' } } }] },
  forbidden: { status: 403, body: { message: 'API rate limit exceeded' } },
  unavailable: { status: 503, body: {} },
};
for (const [name, answer] of Object.entries(failures)) {
  test(`history ${name} preserves skills with an explicit unknown date and warning`, async (t) => {
    const answers = recording();
    answers[historyUrl(PATH)] = answer;
    const app = await fixture(answers);
    t.after(app.close);
    const response = await fetch(`${app.url}/api/scan?repository=github.com/${ID}`);
    assert.equal(response.status, 200);
    const result = await response.json() as WebResult;
    assert.equal(result.skills[0].lastUpdated, null);
    assert.equal(result.skills[0].content, skill('Check', 'Verify commands.'));
    assert.ok(result.warnings.some((warning: string) => warning.includes(`${PATH}: last updated date unavailable`)));
  });
}

test('organization JSON and streaming results retain skill history', async (t) => {
  const answers = recording();
  answers['https://api.github.com/orgs/Test'] = { status: 200, body: { login: 'Test' } };
  answers['https://api.github.com/orgs/Test/repos?type=all&per_page=100&page=1'] = {
    status: 200, body: [{ full_name: ID, default_branch: 'main' }],
  };
  const app = await fixture(answers);
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?organization=Test`);
  const result = await response.json() as WebResult;
  assert.equal(result.skills[0].lastUpdated, ISO);
  assert.equal(result.repositories[0].skills[0].lastUpdated, ISO);
  const stream = await fetch(`${app.url}/api/scan?organization=Test`, { headers: { Accept: 'application/x-ndjson' } });
  const events = (await stream.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events[1].result.skills[0].lastUpdated, ISO);
  assert.match(events[1].warnings.join('\n'), /Test\/history:.*last updated date unavailable/);
  assert.equal(events.at(-1).type, 'done');
});

test('web dates update on keyboard selection and filtering, in repository and organization views', async (t) => {
  const answers = recording();
  answers['https://api.github.com/orgs/Test'] = { status: 200, body: { login: 'Test' } };
  answers['https://api.github.com/orgs/Test/repos?type=all&per_page=100&page=1'] = {
    status: 200, body: [{ full_name: ID, default_branch: 'main' }],
  };
  const app = await fixture(answers);
  t.after(app.close);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', timezoneId: 'Pacific/Honolulu' });
  await page.goto(app.url);
  await expect(page.locator('#skill-updated')).toBeHidden();
  for (const mode of ['repository', 'organization']) {
    await page.getByLabel('Scan scope').selectOption(mode);
    await page.locator('#repository').fill(mode === 'repository' ? `github.com/${ID}` : 'Test');
    await page.locator('#repository').press('Enter');
    await expect(page.locator('#skill-updated')).toHaveText('Last updated: Mar 12, 2025, 14:30 UTC');
    await expect(page.locator('#skill-updated time')).toHaveAttribute('datetime', ISO);
    const count = app.calls.length;
    await page.setViewportSize({ width: 390, height: 844 });
    const other = page.getByRole('navigation', { name: 'Skills' }).getByRole('button', { name: /Other/ });
    await other.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#skill-updated')).toHaveText('Last updated: Unknown');
    await expect(page.locator('#skill-updated time')).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Filter skills' }).fill('Check');
    await expect(page.locator('#skill-updated time')).toHaveAttribute('datetime', ISO);
    assert.equal(app.calls.length, count, 'selection and filtering reuse history');
    assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  }
});

test('web history requests are bounded and an interrupted lookup preserves the skill', async (t) => {
  const paths = Array.from({ length: 9 }, (_, index) => `.agents/skills/skill-${index}/SKILL.md`);
  let active = 0;
  let maximum = 0;
  const requested: string[] = [];
  const app = await listen(createWebServer({ open: async () => ({
    repository: { id: ID, organization: 'Test', name: 'history', url: `https://github.com/${ID}`, commit: EXAMPLE_COMMIT },
    paths: [...paths, '.agents/skills/unreadable/SKILL.md'], warnings: [],
    read: async (path) => paths.includes(path) ? new TextEncoder().encode(skill(path)) : undefined,
    lastUpdated: async (path) => {
      requested.push(path);
      maximum = Math.max(maximum, ++active);
      try {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (path === paths[0]) throw new Error('private transport details');
        return DATE;
      } finally { active--; }
    },
  }) }));
  t.after(app.close);
  const response = await fetch(`${app.url}/api/scan?repository=github.com/${ID}`);
  assert.equal(response.status, 200);
  const result = await response.json() as WebResult;
  assert.equal(result.skills.length, 9);
  assert.equal(result.skills[0].lastUpdated, null);
  assert.equal(result.skills[1].lastUpdated, ISO);
  assert.equal(maximum, 4);
  assert.deepEqual(requested, paths);
  assert.doesNotMatch(JSON.stringify(result), /private transport details/);
  assert.match(result.warnings.join('\n'), /skill-0\/SKILL.md: last updated date unavailable/);
});
