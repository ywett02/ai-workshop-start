// Saves PNG frames of a WebM at the given seconds and prints its duration, by playing it in Chromium
// (Playwright's bundled ffmpeg only encodes; it cannot extract frames).
// Usage: node .agents/skills/record-demo/scripts/frames.ts <video.webm> <out-dir> <seconds...>
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const [video, outDir, ...times] = process.argv.slice(2);
if (!video || !outDir || !times.length) throw new Error('Usage: frames.ts <video.webm> <out-dir> <seconds...>');
const viewer = resolve(outDir, 'frames-viewer.html');
mkdirSync(outDir, { recursive: true });
writeFileSync(viewer, `<body style="margin:0"><video muted preload="auto" style="width:1280px" src="file://${resolve(video)}"></video>`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`file://${viewer}`);
await page.waitForFunction(() => document.querySelector('video')!.readyState >= 2);
console.log(`duration ${await page.evaluate(() => document.querySelector('video')!.duration)}s`);
for (const time of times) {
  await page.evaluate((time) => new Promise((done) => {
    const element = document.querySelector('video')!;
    element.onseeked = done;
    element.currentTime = Number(time);
  }), time);
  const file = resolve(outDir, `${basename(video, '.webm')}-${time}s.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
