import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/e2e-report.ts', import.meta.url));
const IMAGES = 'https://raw.githubusercontent.com/o/r/e2e-diffs/pr-1/9';
const RUN = 'https://github.com/o/r/actions/runs/9';

/** Results as the CI container writes them: absolute paths from another machine. */
function results(directory: string, tests: { title: string; status: string; errors: string[]; snapshots?: string[] }[]) {
  const root = join(directory, 'test-results');
  const suites = [{ title: 'demo.spec.ts', specs: tests.map((item) => {
    const output = `/__w/r/r/test-results/demo-${item.title.replace(/ /g, '-')}`;
    mkdirSync(join(root, `demo-${item.title.replace(/ /g, '-')}`), { recursive: true });
    const attachments = (item.snapshots ?? []).flatMap((name) => ['expected', 'actual', 'diff'].map((kind) => {
      writeFileSync(join(root, `demo-${item.title.replace(/ /g, '-')}`, `${name}-${kind}.png`), `${name} ${kind}`);
      return { name: `${name}-${kind}.png`, path: kind === 'expected' ? `/__w/r/r/e2e/__screenshots__/demo.spec.ts/${name}.png` : `${output}/${name}-${kind}.png` };
    }));
    return { title: item.title, tests: [{ results: [{ status: item.status, errors: item.errors.map((message) => ({ message })), attachments }] }] };
  }) }];
  writeFileSync(join(root, 'results.json'), JSON.stringify({ suites }));
  return join(root, 'results.json');
}

function report(t: { after: (fn: () => void) => void }, setup: (directory: string) => string) {
  const directory = mkdtempSync(join(tmpdir(), 'e2e-report-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const out = join(directory, 'out');
  const run = spawnSync(process.execPath, [SCRIPT, setup(directory), out, IMAGES, RUN], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return { comment: readFileSync(join(out, 'comment.md'), 'utf8'), failed: existsSync(join(out, 'failed')), images: readdirSync(join(out, 'images')).sort() };
}

const mismatch = (pixels: number, name: string) =>
  `Error: \x1b[2mexpect(\x1b[22mpage\x1b[2m).\x1b[22mtoHaveScreenshot(expected) failed\n\n  ${pixels} pixels (ratio 0.05 of all image pixels) are different.\n\n  Snapshot: ${name}.png\n\nCall log:\n`;

test('e2e report: every changed screenshot is shown with expected, actual and diff images', (t) => {
  const { comment, failed, images } = report(t, (directory) => results(directory, [
    { title: 'skill filter', status: 'failed', errors: [mismatch(88268, 'repository-results'), mismatch(12, 'filter-matches')], snapshots: ['repository-results', 'filter-matches'] },
    { title: 'organization scan', status: 'passed', errors: [] },
  ]));
  assert.ok(failed);
  assert.ok(comment.startsWith('<!-- e2e-screenshots -->\n'));
  assert.match(comment, /### ❌ e2e: 2 screenshots changed\n/);
  assert.match(comment, /add the `update-screenshots` label/);
  assert.match(comment, /#### skill filter › `repository-results.png`\n\n88268 pixels \(ratio 0\.05 of all image pixels\) are different\./);
  assert.match(comment, /#### skill filter › `filter-matches.png`\n\n12 pixels/);
  assert.ok(comment.includes(`[![diff](${IMAGES}/filter-matches-diff.png)](${IMAGES}/filter-matches-diff.png)`));
  assert.ok(comment.includes(`](${RUN})`));
  assert.deepEqual(images, ['filter-matches-actual.png', 'filter-matches-diff.png', 'filter-matches-expected.png',
    'repository-results-actual.png', 'repository-results-diff.png', 'repository-results-expected.png']);
});

test('e2e report: failures other than screenshots are listed without images', (t) => {
  const { comment, failed, images } = report(t, (directory) => results(directory, [
    { title: 'organization scan', status: 'failed', errors: ['Error: expect(locator).toHaveText(expected) failed\n\nExpected: "4"'] },
  ]));
  assert.ok(failed);
  assert.match(comment, /### ❌ e2e: 1 other failure\n/);
  assert.match(comment, /- organization scan: Error: expect\(locator\)\.toHaveText\(expected\) failed/);
  assert.doesNotMatch(comment, /update-screenshots/);
  assert.deepEqual(images, []);
});

test('e2e report: passing runs say the screenshots match', (t) => {
  const { comment, failed } = report(t, (directory) => results(directory, [{ title: 'skill filter', status: 'passed', errors: [] }]));
  assert.ok(!failed);
  assert.match(comment, /### ✅ All screenshots match their baselines/);
});

test('e2e report: a run without results says so', (t) => {
  const { comment, failed } = report(t, (directory) => join(directory, 'missing.json'));
  assert.ok(failed);
  assert.match(comment, /### ❌ e2e produced no results/);
});
