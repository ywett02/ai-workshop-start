import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium, expect } from '@playwright/test';
import { COMMIT, CONTENT, webFixture } from './web-helpers.ts';

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
