import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);

test('status update: documented commands resolve the requested date before converting to UTC', async (t) => {
  const skill = await readFile('.agents/skills/status-update/SKILL.md', 'utf8');
  const commands = /```sh\n([\s\S]*?)\n\s*```/.exec(skill)?.[1];
  assert.ok(commands, 'The skill must document its start-time conversion commands');

  for (const [start, expected] of [
    ['2026-01-15 00:00', '2026-01-15T05:00:00Z'],
    ['2026-07-15 00:00', '2026-07-15T04:00:00Z'],
    ['2026-01-15', '2026-01-15T05:00:00Z'],
    ['2026-01-15T00:00:00+02:00', '2026-01-14T22:00:00Z'],
  ] as const) {
    await t.test(start, async () => {
      const { stdout } = await run('sh', ['-eu', '-c', commands], {
        env: { ...process.env, TZ: 'America/New_York', start },
        timeout: 5_000,
      });
      assert.equal(stdout.trim(), expected);
    });
  }
});
