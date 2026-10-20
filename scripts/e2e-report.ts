// Turns Playwright's JSON results into a pull request comment that shows each changed screenshot.
// Usage: node scripts/e2e-report.ts <results.json> <out-dir> <images-url> <run-url>
// Writes <out-dir>/comment.md, copies expected/actual/diff images to <out-dir>/images/, and
// creates <out-dir>/failed when anything failed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const MARKER = '<!-- e2e-screenshots -->';

type Attachment = { name: string; path?: string };
type Result = { status: string; errors: { message?: string }[]; attachments: Attachment[] };
type Suite = { title: string; specs?: { title: string; tests: { results: Result[] }[] }[]; suites?: Suite[] };
type Changed = { test: string; snapshot: string; pixels: string; images: Record<'expected' | 'actual' | 'diff', string | undefined> };

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

export function changes(report: { suites: Suite[] }) {
  const changed: Changed[] = [];
  const failures: string[] = [];
  const visit = (suite: Suite) => {
    for (const spec of suite.specs ?? []) {
      // The last attempt decides the outcome.
      const result = spec.tests.at(-1)?.results.at(-1);
      if (!result || result.status === 'passed' || result.status === 'skipped') continue;
      for (const error of result.errors) {
        const message = plain(error.message ?? '');
        const snapshot = message.match(/Snapshot: (\S+)\.png/)?.[1];
        if (!snapshot) {
          failures.push(`${spec.title}: ${message.split('\n').find((line) => line.trim()) ?? result.status}`);
          continue;
        }
        const attachment = (kind: string) => result.attachments.find((item) => item.name === `${snapshot}-${kind}.png`)?.path;
        changed.push({
          test: spec.title,
          snapshot,
          pixels: message.match(/\d+ pixels \(ratio [\d.]+ of all image pixels\) are different\.?/)?.[0]
            ?? message.match(/Expected an image .*/)?.[0] ?? 'Screenshot differs.',
          images: { expected: attachment('expected'), actual: attachment('actual'), diff: attachment('diff') },
        });
      }
    }
    suite.suites?.forEach(visit);
  };
  report.suites.forEach(visit);
  return { changed, failures };
}

if (import.meta.main) {
  const [resultsPath, outDir, imagesUrl, runUrl] = process.argv.slice(2);
  if (!resultsPath || !outDir || !imagesUrl || !runUrl) throw new Error('Usage: e2e-report.ts <results.json> <out-dir> <images-url> <run-url>');
  mkdirSync(join(outDir, 'images'), { recursive: true });
  const lines = [MARKER];
  if (!existsSync(resultsPath)) {
    lines.push('### ❌ e2e produced no results', '', `The run stopped before the tests reported. See [the run](${runUrl}).`);
    writeFileSync(join(outDir, 'failed'), '');
  } else {
    const { changed, failures } = changes(JSON.parse(readFileSync(resultsPath, 'utf8')));
    // Attachment paths are absolute in the machine that ran the tests; the files sit next to the results.
    const local = (path: string) => resolve(dirname(resultsPath), path.slice(path.lastIndexOf('/test-results/') + '/test-results/'.length));
    if (!changed.length && !failures.length) {
      lines.push('### ✅ All screenshots match their baselines', '', `Checked in [this run](${runUrl}).`);
    } else {
      writeFileSync(join(outDir, 'failed'), '');
      const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
      const parts = [changed.length && `${count(changed.length, 'screenshot')} changed`, failures.length && count(failures.length, 'other failure')];
      lines.push(`### ❌ e2e: ${parts.filter(Boolean).join(', ')}`, '');
      if (changed.length) {
        lines.push('If these changes are intended, add the `update-screenshots` label to accept them as the new baselines.', '');
      }
      for (const change of changed) {
        lines.push(`#### ${change.test} › \`${change.snapshot}.png\``, '', change.pixels, '', '| Expected | Actual | Diff |', '| --- | --- | --- |');
        const cells = (['expected', 'actual', 'diff'] as const).map((kind) => {
          const path = change.images[kind];
          if (!path) return '—';
          const name = `${change.snapshot}-${kind}.png`;
          // Playwright copies the expected image next to the actual one; the attachment may point at the baseline instead.
          const source = join(dirname(local(change.images.actual ?? path)), name);
          if (!existsSync(source)) return '—';
          copyFileSync(source, join(outDir, 'images', name));
          return `[![${kind}](${imagesUrl}/${name})](${imagesUrl}/${name})`;
        });
        lines.push(`| ${cells.join(' | ')} |`, '');
      }
      if (failures.length) lines.push('Other failures:', '', ...failures.map((failure) => `- ${failure}`), '');
      lines.push(`Videos and the full report: \`e2e-results\` artifact of [this run](${runUrl}).`);
    }
  }
  writeFileSync(join(outDir, 'comment.md'), `${lines.join('\n')}\n`);
  console.log(basename(join(outDir, 'comment.md')), existsSync(join(outDir, 'failed')) ? 'failed' : 'passed');
}
