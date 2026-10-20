import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { repositories } from './repositories.ts';

const execute = promisify(execFile);
const executable = fileURLToPath(new URL('../../skill-atlas', import.meta.url));

// These are live, full-process tests: no injected fetch, replay, or CLI mocks.
// Nonzero exits, timeouts, network errors, and unexpected warnings fail the test.
for (const { repository, commit, snapshot } of repositories) {
  test(`real CLI: ${repository} at ${commit}`, { timeout: 130_000 }, async () => {
    const [expectedStdout, expectedStderr] = await Promise.all([
      readFile(new URL(`./expected/${snapshot}.stdout.txt`, import.meta.url), 'utf8'),
      readFile(new URL(`./expected/${snapshot}.stderr.txt`, import.meta.url), 'utf8'),
    ]);
    const { stdout, stderr } = await execute(executable, [
      'scan', `github.com/${repository}/tree/${commit}`,
    ], { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(stdout, expectedStdout, `${repository}: stdout differs from the checked-in expectation`);
    assert.equal(stderr, expectedStderr, `${repository}: stderr differs from the checked-in expectation`);
  });
}
