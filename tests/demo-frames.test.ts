import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('demo frames: create nested scratch directories and reuse existing ones', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'skill-atlas-frames-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const output = join(scratch, 'new', 'frames');

  for (const time of ['1', '2']) {
    const { stdout } = await run(process.execPath, [
      '.agents/skills/record-demo/scripts/frames.ts',
      'docs/demo/skill-filter.webm', output, time,
    ], { timeout: 30_000 });
    const duration = /duration ([\d.]+)s/.exec(stdout);
    assert.ok(duration, stdout);
    assert.ok(Number(duration[1]) > Number(time));
    assert.match(await readFile(join(output, 'frames-viewer.html'), 'utf8'), /<video /);
    const frame = join(output, `skill-filter-${time}s.png`);
    assert.ok(stdout.includes(frame));
    assert.deepEqual((await readFile(frame)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});
