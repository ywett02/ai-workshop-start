import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { COMMIT, CONTENT, webFixture } from './web-helpers.ts';

test('web view: selected descriptions wrap long URLs and unbroken words on mobile and desktop', async (t) => {
  const descriptions = ['https://example.com/' + 'a'.repeat(500), 'b'.repeat(500)];
  const app = await webFixture(Object.fromEntries(descriptions.map((description, index) => [
    `.agents/skills/long-${index}/SKILL.md`,
    `---\nname: Long description ${index}\ndescription: "${description}"\n---\nSource\n`,
  ])));
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  for (const width of [375, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 812 } });
    await page.goto(app.url);
    const input = page.getByLabel('GitHub repository', { exact: true });
    await input.fill('https://github.com/Test/skills');
    await input.press('Enter');
    const description = page.locator('#skill-description');
    for (const [index, text] of descriptions.entries()) {
      if (index > 0) await page.getByRole('button', { name: `Long description ${index}` }).click();
      await expect(description).toHaveText(text);
      const layout = await description.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(element);
        const fragments = [...range.getClientRects()];
        return {
          fits: element.scrollWidth <= element.clientWidth,
          wraps: fragments.length > 1,
          readable: fragments.every((rect) => rect.left >= bounds.left && rect.right <= bounds.right + 1
            && rect.top >= bounds.top && rect.bottom <= bounds.bottom + 1),
        };
      });
      assert.deepEqual(layout, { fits: true, wraps: true, readable: true },
        `description ${index} must remain fully readable at ${width} px`);
      assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    }
    await page.close();
  }
});

test('web view: live skill filtering, highlights, selection, counts, clear and scan reset', async (t) => {
  const app = await webFixture();
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });
  const clear = page.getByRole('button', { name: 'Clear filter', exact: true });
  const list = page.getByRole('navigation', { name: 'Skills' });
  const buttons = list.getByRole('button');
  const repository = page.getByLabel('GitHub repository', { exact: true });
  await expect(filter).toBeHidden();
  await repository.fill('https://github.com/Test/skills');
  await repository.press('Enter');
  await expect(buttons).toHaveCount(3);
  let requests = 0;
  page.on('request', () => { requests++; });
  const reads = app.reads.length;

  // Names and full descriptions match without case sensitivity; selection survives if visible.
  await buttons.filter({ hasText: 'Beta' }).click();
  await filter.fill(' sKiLl ');
  await expect(buttons).toHaveCount(2);
  await expect(page.locator('#skill-count')).toHaveText('2 of 3');
  await expect(page.locator('#filter-status')).toHaveText('2 of 3 skills match.');
  await expect(page.locator('#skill-name')).toHaveText('Beta');
  await expect(buttons.last()).toHaveAttribute('aria-current', 'true');
  await expect(list.locator('mark')).toHaveText(['skill', 'skill']);
  await expect(page.locator('#warnings')).toBeVisible();
  await expect(page.locator('#repository-info')).toContainText('Test/skills');

  await filter.fill('  aLpHa  ');
  await expect(buttons).toHaveCount(1);
  await expect(list.locator('strong mark')).toHaveText('Alpha');
  await expect(page.locator('#skill-content')).toHaveText(CONTENT);
  await expect(buttons.first()).toHaveAttribute('aria-current', 'true');
  await filter.fill('FULL DESCRIPTION');
  await expect(buttons).toHaveCount(1);
  await expect(list.locator('span mark')).toHaveText('Full description');

  for (const query of ['[.*', '<img src=x onerror="window.pwned=true">']) {
    await filter.fill(query);
    await expect(buttons).toHaveCount(0);
    await expect(list).toContainText('No skills match your filter.');
    await expect(page.locator('#skill-count')).toHaveText('0 of 3');
    await expect(page.locator('#document')).toBeHidden();
  }
  assert.equal(await page.evaluate('window.pwned'), undefined);
  assert.equal(await list.locator('script, img').count(), 0);
  await clear.focus();
  await page.keyboard.press('Enter');
  await expect(filter).toHaveValue('');
  await expect(filter).toBeFocused();
  await expect(buttons).toHaveCount(3);
  await expect(page.locator('#skill-count')).toHaveText('3');
  await expect(list.locator('mark')).toHaveCount(0);
  await expect(page.locator('#skill-name')).toHaveText('Alpha');
  await expect(buttons).toHaveText([/Alpha/, /Beta/, /z-broken/]);
  await filter.fill('   ');
  await expect(buttons).toHaveCount(3);

  await page.setViewportSize({ width: 390, height: 844 });
  await filter.fill('beta');
  await filter.press('Tab');
  await expect(clear).toBeFocused();
  await clear.press('Tab');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#skill-name')).toHaveText('Beta');
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(requests, 0, 'filtering never makes network requests');
  assert.equal(app.reads.length, reads, 'filtering never rereads source files');

  // Reset immediately, even before the next response arrives.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/scan?**', async (route) => { await gate; await route.continue(); }, { times: 1 });
  await repository.fill('https://github.com/Test/empty');
  await repository.press('Enter');
  await expect(filter).toBeHidden();
  await expect(page.locator('#filter-query')).toHaveValue('');
  await expect(page.locator('#skill-count')).toHaveText('0');
  release();
  await expect(page.locator('#status')).toContainText('No project skills found');
  await expect(filter).toBeHidden();
  await repository.fill('https://github.com/Test/missing');
  await repository.press('Enter');
  await expect(page.locator('#status')).toContainText('Repository not found');
  await expect(filter).toBeHidden();
  await repository.fill('https://github.com/Test/skills');
  await repository.press('Enter');
  await expect(filter).toBeVisible();
  await expect(filter).toHaveValue('');
  await expect(buttons).toHaveCount(3);
  await expect(page.locator('#skill-name')).toHaveText('Alpha');
});

test('web view: filter matches are literal, inert and visible in long descriptions', async (t) => {
  const name = '<img src=x onerror=window.pwned=true> [a.*]';
  const app = await webFixture({
    '.agents/skills/safe/SKILL.md': `---\nname: '${name}'\ndescription: '${'Long introduction. '.repeat(30)}Needle and NEEDLE <script>window.pwned=true</script>'\n---\nSource only term\n`,
  });
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  await page.getByLabel('GitHub repository', { exact: true }).fill('https://github.com/Test/skills');
  await page.getByRole('button', { name: /Explore repository/ }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });
  const list = page.getByRole('navigation', { name: 'Skills' });
  await filter.fill('[a.*]');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list.locator('mark')).toHaveText('[a.*]');
  await filter.fill('needle');
  await expect(list.locator('mark')).toHaveText(['Needle', 'NEEDLE']);
  assert.equal(await list.locator('mark').first().evaluate((mark) => {
    const parent = mark.parentElement!.getBoundingClientRect();
    const rect = mark.getBoundingClientRect();
    return rect.top >= parent.top && rect.bottom <= parent.bottom;
  }), true, 'description preview scrolls to the match');
  await filter.fill('<script>');
  await expect(list.locator('mark')).toHaveText('<script>');
  await filter.fill('<img');
  await expect(list.locator('mark')).toHaveText('<img');
  await expect(list.locator('strong')).toHaveText(name);
  assert.equal(await list.locator('img, script').count(), 0);
  assert.equal(await page.evaluate('window.pwned'), undefined);
  await filter.fill('Source only term');
  await expect(list.getByRole('button')).toHaveCount(0);
});

test('web view: scan, select, warnings, safe source, empty result, retry and mobile keyboard use', async (t) => {
  const app = await webFixture();
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  const input = page.getByLabel('GitHub repository', { exact: true });
  const submit = page.getByRole('button', { name: /Explore repository/ });
  const skillList = page.getByRole('navigation', { name: 'Skills' });
  await expect(page.getByText('Instructions, in focus.')).toBeVisible();
  await expect(page.getByText('Ready when you are.', { exact: false })).toBeVisible();

  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/scan?**', async (route) => { await gate; await route.continue(); }, { times: 1 });
  await input.fill('https://github.com/Test/skills');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Exploring…' })).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(page.getByText('Exploring repository and reading skill files…')).toBeVisible();
  release();

  await expect(skillList.getByRole('button')).toHaveCount(3);
  await expect(skillList.getByRole('button').first()).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('#skill-content')).toHaveText(CONTENT);
  await expect(page.locator('#warnings')).toContainText('incomplete and may omit');
  await expect(page.locator('#warnings')).toContainText('conflicting copy');
  await expect(page.locator('#warnings')).toContainText('front matter');
  await expect(page.locator('#warnings')).toContainText('unreadable');
  await expect(page.locator('#skill-copies')).toContainText('.claude/skills/alpha/SKILL.md');
  await expect(page.getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', `https://github.com/Test/skills/blob/${COMMIT}/.agents/skills/alpha/SKILL.md`);
  assert.equal(await page.evaluate('window.pwned'), undefined);
  assert.equal(await page.locator('#skill-content script, #skill-content img').count(), 0);
  await skillList.getByRole('button', { name: /Beta/ }).click();
  await expect(page.locator('#skill-name')).toHaveText('Beta');
  await expect(page.locator('#skill-content')).toContainText('Run the tests.');
  await expect(page.locator('#skill-copies')).toBeHidden();

  await input.fill('https://github.com/Test/empty');
  await submit.click();
  await expect(page.getByText('No project skills found in this repository.')).toBeVisible();
  await expect(skillList.getByRole('button')).toHaveCount(0);
  await expect(page.locator('#document')).toBeHidden();
  await expect(page.locator('#warnings')).toBeHidden();

  await input.fill('https://github.com/Test/missing');
  await submit.click();
  await expect(page.locator('#status')).toContainText('Repository not found');
  await expect(submit).toBeEnabled();
  await input.fill('/etc/passwd');
  await submit.click();
  await expect(page.locator('#status')).toContainText('Enter a GitHub repository URL');

  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('github.com/Test/skills');
  await input.press('Enter');
  await expect(skillList.getByRole('button')).toHaveCount(3);
  await skillList.getByRole('button', { name: /Beta/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#skill-name')).toHaveText('Beta');
  await expect(skillList.getByRole('button', { name: /Beta/ })).toHaveAttribute('aria-current', 'true');
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  assert.equal(app.reads.length, 10, 'selection never refetches files');
});

test('organization view: loading, repository groups, safe selection, partial and empty states, retry and mode switching', async (t) => {
  const { organizationFixture, organizationRecording, ORG } = await import('./organization-helpers.ts');
  const recording = organizationRecording();
  recording['https://api.github.com/orgs/Empty'] = { status: 200, body: { login: 'Empty' } };
  recording['https://api.github.com/orgs/Empty/repos?type=all&per_page=100&page=1'] = { status: 200, body: [] };
  recording['https://api.github.com/orgs/Missing'] = { status: 404, body: { message: 'Not Found' } };
  const app = await organizationFixture(recording);
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(app.url);
  const mode = page.getByLabel('Scan scope');
  await mode.selectOption('organization');
  const input = page.getByLabel('GitHub organization', { exact: true });
  await input.fill(ORG);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/scan?**', async (route) => { await gate; await route.continue(); }, { times: 1 });
  await input.press('Enter');
  await expect(mode).toBeDisabled();
  await expect(input).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Exploring organization');
  release();
  const list = page.getByRole('navigation', { name: 'Skills' });
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('heading')).toHaveText([
    /Example\/alpha.*1 skill/, /Example\/empty.*0 skills/, /Example\/zeta.*1 skill/,
  ]);
  await expect(page.locator('#repository-info')).toContainText('3 of 4 repositories scanned');
  await expect(page.locator('#status')).toContainText('Results may be incomplete');
  await expect(page.locator('#warnings')).toContainText('Example/broken');
  await expect(page.locator('#skill-repository')).toContainText('Example/alpha');
  assert.equal(await page.evaluate('window.pwned'), undefined);
  await list.getByRole('button').last().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#skill-repository')).toContainText('Example/zeta');
  await expect(page.locator('#skill-content')).toContainText('Second repository.');
  await expect(page.locator('#source-link')).toHaveAttribute('href', /Example\/zeta\/blob\//);
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });
  await filter.fill('second');
  await expect(list.getByRole('heading')).toHaveText([/Example\/zeta/]);
  await expect(list.locator('span mark')).toHaveText('Second');
  await expect(page.locator('#skill-count')).toHaveText('1 of 2');
  await expect(page.locator('#skill-repository')).toContainText('Example/zeta');
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(list.getByRole('heading')).toHaveCount(3);
  assert.equal(app.calls.filter((c) => c.url.includes('raw.githubusercontent.com')).length, 2);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await input.fill('Empty');
  await input.press('Enter');
  await expect(page.locator('#status')).toContainText('No project skills found in this organization');
  await expect(list.getByRole('button')).toHaveCount(0);
  await expect(page.locator('#document')).toBeHidden();
  await expect(page.locator('#warnings')).toBeHidden();
  await input.fill('Missing');
  await input.press('Enter');
  await expect(page.locator('#status')).toContainText('Organization not found');
  await expect(mode).toBeEnabled();
  await mode.selectOption('repository');
  await page.getByLabel('GitHub repository', { exact: true }).fill('github.com/Example/alpha');
  await page.getByRole('button', { name: /Explore repository/ }).click();
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(page.locator('#repository-info')).toContainText('Example/alpha');
});

test('web view: Unicode lowercase expansion preserves highlights and description excerpts', async (t) => {
  const app = await webFixture({
    '.agents/skills/unicode/SKILL.md': `---\nname: İstanbul skill\ndescription: '${'İ'.repeat(50)} Needle'\n---\n`,
  });
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  await page.getByLabel('GitHub repository', { exact: true }).fill('https://github.com/Test/skills');
  await page.getByRole('button', { name: /Explore repository/ }).click();
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });
  const list = page.getByRole('navigation', { name: 'Skills' });
  await filter.fill('skill');
  await expect(list.locator('strong mark')).toHaveText('skill');
  await expect(list.locator('strong')).toHaveText('İstanbul skill');
  await filter.fill('needle');
  await expect(page.locator('#skill-count')).toHaveText('1 of 1');
  await expect(list.locator('span mark')).toHaveText('Needle');
  assert.equal(await list.locator('span mark').evaluate((mark) => {
    const parent = mark.parentElement!.getBoundingClientRect();
    const rect = mark.getBoundingClientRect();
    return rect.top >= parent.top && rect.bottom <= parent.bottom;
  }), true);
  await filter.fill('i');
  await expect(list.locator('strong mark')).toHaveText(['İ', 'i']);
  await expect(list.locator('strong')).toHaveText('İstanbul skill');
  await expect(list.locator('span')).toHaveText(`${'İ'.repeat(50)} Needle`);
});

test('organization view: skills appear while other repositories are still being scanned', async (t) => {
  const { organizationRecording, ORG } = await import('./organization-helpers.ts');
  const { listen } = await import('./web-helpers.ts');
  const { createWebServer } = await import('../src/server.ts');
  const { replay } = await import('../src/core/replay.ts');
  const recorded = replay(organizationRecording());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  t.after(() => release());
  const app = await listen(createWebServer({ github: { fetch: async (url, init) => {
    if (url === `https://api.github.com/repos/${ORG}/zeta/commits/main`) await gate;
    return recorded(url, init);
  } } }));
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  await page.getByLabel('Scan scope').selectOption('organization');
  const input = page.getByLabel('GitHub organization', { exact: true });
  await input.fill(ORG);
  await input.press('Enter');
  const list = page.getByRole('navigation', { name: 'Skills' });
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(page.locator('#status')).toContainText('3 of 4 repositories checked, 1 project skill so far');
  await expect(page.locator('#repository-info')).toContainText('2 of 4 repositories scanned');
  await expect(page.locator('#warnings')).toContainText('Example/broken');
  await expect(input).toBeDisabled();
  await list.getByRole('button').focus();
  await expect(page.locator('#skill-repository')).toContainText('Example/alpha');

  release();
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('heading')).toHaveText([/Example\/alpha/, /Example\/empty/, /Example\/zeta/]);
  await expect(list.getByRole('button').first()).toBeFocused();
  await expect(page.locator('#skill-repository')).toContainText('Example/alpha');
  await expect(page.locator('#status')).toContainText('2 project skills in Example');
  await expect(page.locator('#status')).toContainText('Results may be incomplete');
  await expect(input).toBeEnabled();
});

for (const ending of ['a broken connection', 'an early end']) test(`organization view: ${ending} keeps results and says they may be incomplete`, async (t) => {
  const { createServer } = await import('node:http');
  const { listen } = await import('./web-helpers.ts');
  const { createWebServer } = await import('../src/server.ts');
  const web = createWebServer();
  const skill = { id: 'Example/a:.agents/skills/a/SKILL.md', name: 'Alpha', description: 'First', path: '.agents/skills/a/SKILL.md', copies: [], repository: 'Example/a', commit: COMMIT, link: 'https://github.com/Example/a', content: 'Source' };
  const lines = [
    { type: 'start', organization: 'Example', repositoryCount: 2, warnings: [] },
    { type: 'repository', id: 'Example/a', result: { repository: { id: 'Example/a', commit: COMMIT }, skills: [skill], warnings: [] }, warnings: [] },
  ];
  // Only the scan is replaced; the page and its assets come from the real server.
  const app = await listen(createServer((request, response) => {
    if (!request.url?.startsWith('/api/scan')) return void web.emit('request', request, response);
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    response.write(lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
    if (ending === 'an early end') response.end();
    else setTimeout(() => response.destroy(), 100);
  }));
  t.after(app.close);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(app.url);
  await page.getByLabel('Scan scope').selectOption('organization');
  const input = page.getByLabel('GitHub organization', { exact: true });
  await input.fill('Example');
  await input.press('Enter');
  await expect(page.locator('#status')).toHaveText('The organization scan stopped early; results may be incomplete. Please try again.');
  await expect(page.getByRole('navigation', { name: 'Skills' }).getByRole('button')).toHaveText([/Alpha/]);
  await expect(page.locator('#repository-info')).toContainText('1 of 2 repositories scanned');
  await expect(input).toBeEnabled();
});
