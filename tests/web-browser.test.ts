import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { COMMIT, CONTENT, webFixture } from './web-helpers.ts';

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
