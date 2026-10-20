import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { openGitHub } from '../src/core/github.ts';
import { scan } from '../src/core/scan.ts';

// An offline recording cannot establish live GitHub performance. Opt in explicitly.
test('live intellij-community scan completes in under five seconds', {
  skip: process.env.SKILL_ATLAS_LIVE_TESTS !== '1' && 'set SKILL_ATLAS_LIVE_TESTS=1 to run the live performance acceptance test',
  timeout: 30_000,
}, async () => {
  const started = performance.now();
  const result = await scan(await openGitHub('https://github.com/JetBrains/intellij-community', {
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }),
    token: process.env.GITHUB_TOKEN || undefined,
  }));
  const elapsed = performance.now() - started;
  assert.equal(result.repository.id, 'JetBrains/intellij-community');
  assert.ok(elapsed < 5_000, `scan took ${Math.round(elapsed)} ms; expected under 5000 ms`);
});
