// The demos as tests: each key moment is a screenshot compared with its Linux baseline.
import { expect, test as base, type Page } from '@playwright/test';
import { createWebServer } from '../src/server.ts';
import { API } from '../tests/scenarios.ts';
import { listen } from '../tests/web-helpers.ts';
import { heldReplay, ORGANIZATION, organizationRecording, REPOSITORY, repositoryRecording } from './data.ts';

const test = base.extend<{ app: Awaited<ReturnType<typeof start>> }>({
  app: async ({}, use, testInfo) => {
    const app = await start(testInfo.title.startsWith('organization') ? organizationRecording() : repositoryRecording());
    await use(app);
    await app.close();
  },
});

async function start(recording: ReturnType<typeof repositoryRecording>) {
  const github = heldReplay(recording);
  return { ...await listen(createWebServer({ github: { fetch: github.fetch } })), hold: github.hold };
}

/**
 * A key moment: compared with its baseline, then held for a second so the video shows it.
 * A mismatch does not stop the test, so every changed moment is reported.
 */
async function snapshot(page: Page, name: string) {
  await expect.soft(page).toHaveScreenshot(name, { fullPage: true });
  await page.waitForTimeout(1000);
}

test('skill filter', async ({ page, app }) => {
  await page.goto(app.url);
  await snapshot(page, 'start.png');

  await page.getByLabel('GitHub repository', { exact: true }).fill(`https://github.com/${REPOSITORY}`);
  await page.keyboard.press('Enter');
  const filter = page.getByRole('searchbox', { name: 'Filter skills' });
  await expect(filter).toBeVisible();
  await expect(page.locator('#skill-count')).toHaveText('6');
  await snapshot(page, 'repository-results.png');

  await filter.fill('pull request');
  await expect(page.locator('#filter-status')).toHaveText('3 of 6 skills match.');
  await page.getByRole('navigation', { name: 'Skills' }).getByRole('button', { name: /release-notes/ }).click();
  await expect(page.locator('#skill-name')).toHaveText('release-notes');
  await snapshot(page, 'filter-matches.png');

  await filter.fill('no such skill');
  await expect(page.getByText('No skills match your filter.')).toBeVisible();
  await snapshot(page, 'filter-no-matches.png');

  await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
  await expect(page.locator('#skill-count')).toHaveText('6');
});

test('organization scan', async ({ page, app }) => {
  // Hold one repository so the page is caught mid-scan at the same point on every run.
  const release = app.hold(`${API}/repos/${ORGANIZATION}/website/commits/main`);
  await page.goto(app.url);
  await page.getByLabel('Scan scope').selectOption('organization');
  await page.getByLabel('GitHub organization', { exact: true }).fill(ORGANIZATION);
  await page.keyboard.press('Enter');
  await expect(page.locator('#status')).toContainText('3 of 4 repositories checked');
  await snapshot(page, 'organization-scanning.png');

  release();
  await expect(page.getByLabel('GitHub organization', { exact: true })).toBeEnabled();
  await expect(page.locator('#skill-count')).toHaveText('4');
  await snapshot(page, 'organization-results.png');

  await page.getByRole('searchbox', { name: 'Filter skills' }).fill('release');
  await expect(page.locator('#filter-status')).toHaveText('2 of 4 skills match.');
  await snapshot(page, 'organization-filter.png');
});
