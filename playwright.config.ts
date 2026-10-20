import { defineConfig } from '@playwright/test';

// Baselines are rendered in the Playwright Linux image on CI. Other platforms draw text
// differently, so they run the flows and record videos without comparing screenshots.
export default defineConfig({
  testDir: 'e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  ignoreSnapshots: process.platform !== 'linux',
  forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: { toHaveScreenshot: { maxDiffPixels: 0, threshold: 0 } },
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
    video: { mode: 'on', size: { width: 1280, height: 800 } },
    // Slow enough that every recorded run can be watched.
    launchOptions: { slowMo: 300, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
});
