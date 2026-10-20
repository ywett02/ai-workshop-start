// Records one WebM per demo scenario against a running Skill Atlas server.
// Usage: node .agents/skills/record-demo/scripts/record.ts <server-url> <out-dir> [scenario...]
import { chromium, type Page } from '@playwright/test';
import { renameSync } from 'node:fs';

const typeSlowly = async (page: Page, selector: string, text: string) => {
  const locator = page.locator(selector);
  await locator.fill('');
  await locator.click();
  await locator.pressSequentially(text, { delay: 70 });
};
const scanDone = (page: Page) => page.waitForFunction(() => !document.querySelector<HTMLInputElement>('#repository')!.disabled, null, { timeout: 120000 });

// One scenario per feature; each becomes <out-dir>/<name>.webm.
const scenarios: Record<string, (page: Page) => Promise<void>> = {
  'skill-filter': async (page) => {
    await typeSlowly(page, '#repository', 'https://github.com/JetBrains/kotlin');
    await page.locator('#repository').press('Enter');
    await scanDone(page);
    await page.waitForTimeout(2000);
    await typeSlowly(page, '#filter-query', 'gradle');
    await page.waitForTimeout(1800);
    await page.locator('#skill-list button').nth(1).click();
    await page.waitForTimeout(1800);
    await typeSlowly(page, '#filter-query', 'reproduction');
    await page.waitForTimeout(2000);
    await typeSlowly(page, '#filter-query', 'no such skill');
    await page.waitForTimeout(1800);
    await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
    await page.waitForTimeout(2000);
  },
  'organization-scan': async (page) => {
    await page.locator('#scope').selectOption('organization');
    await page.waitForTimeout(800);
    await typeSlowly(page, '#repository', 'anthropics');
    await page.locator('#repository').press('Enter');
    await scanDone(page);
    await page.waitForTimeout(2500);
    await typeSlowly(page, '#filter-query', 'verify');
    await page.waitForTimeout(2000);
    await page.locator('#skill-list button').nth(1).click();
    await page.waitForTimeout(2500);
  },
};

const [url, outDir, ...names] = process.argv.slice(2);
if (!url || !outDir) throw new Error('Usage: record.ts <server-url> <out-dir> [scenario...]');
const unknown = names.filter((name) => !(name in scenarios));
if (unknown.length) throw new Error(`Unknown scenarios: ${unknown.join(', ')}; known: ${Object.keys(scenarios).join(', ')}`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
for (const name of names.length ? names : Object.keys(scenarios)) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: outDir, size: { width: 1280, height: 800 } } });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForTimeout(1200);
  await scenarios[name](page);
  const video = page.video()!;
  await context.close();
  renameSync(await video.path(), `${outDir}/${name}.webm`);
  console.log(`${outDir}/${name}.webm`);
}
await browser.close();
