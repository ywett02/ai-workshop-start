import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const targetScript = resolve('scripts/e2e-report-targets.ts');
for (const scenario of ['PR', 'fork PR', 'dispatch', 'multiple PRs', 'stale', 'fork dispatch', 'wrong branch', 'no PR', 'tag', 'push', 'API failure']) {
  test(`e2e workflow targets: ${scenario}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-target-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const pr = { number: 23, head: { repo: { full_name: 'owner/repo' }, ref: 'feature/test', sha: 'abc' } };
    if (scenario.startsWith('fork')) pr.head.repo.full_name = 'someone/fork';
    if (scenario === 'stale') pr.head.sha = 'old';
    if (scenario === 'wrong branch') pr.head.ref = 'other';
    writeFileSync(join(dir, 'event.json'), JSON.stringify({ pull_request: pr }));
    const prs = scenario === 'no PR' ? [] : scenario === 'multiple PRs' ? [pr, { ...pr, number: 24 }] : [pr];
    writeFileSync(join(dir, 'answers'), JSON.stringify([[], prs]));
    writeFileSync(join(dir, 'gh'), `#!${process.execPath}
const fs = require('node:fs');
if (process.env.SCENARIO === 'API failure') process.exit(1);
if (process.argv.at(-1) !== 'repos/owner/repo/pulls?state=open&head=owner%3Afeature%2Ftest&per_page=100') process.exit(2);
process.stdout.write(fs.readFileSync(process.env.ANSWERS));
`);
    chmodSync(join(dir, 'gh'), 0o755);
    const out = join(dir, 'output');
    const result = spawnSync(process.execPath, [targetScript], { encoding: 'utf8', env: {
      ...process.env, PATH: `${dir}:${process.env.PATH}`, ANSWERS: join(dir, 'answers'), SCENARIO: scenario,
      GITHUB_EVENT_PATH: join(dir, 'event.json'), GITHUB_OUTPUT: out, GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_REF_TYPE: scenario === 'tag' ? 'tag' : 'branch', GITHUB_REF_NAME: 'feature/test', GITHUB_SHA: 'abc',
      GITHUB_EVENT_NAME: scenario.includes('PR') && !['multiple PRs', 'no PR'].includes(scenario) ? 'pull_request' : scenario === 'push' ? 'push' : 'workflow_dispatch',
    } });
    if (scenario === 'API failure') { assert.notEqual(result.status, 0); return; }
    assert.equal(result.status, 0, result.stderr);
    const expected = scenario === 'multiple PRs' ? [23, 24] : ['PR', 'dispatch'].includes(scenario) ? [23] : [];
    assert.equal(readFileSync(out, 'utf8'), `prs=${JSON.stringify(expected)}\n`);
  });
}

for (const scenario of ['success', 'rejected', 'retry']) {
  test(`e2e image publication: ${scenario}`, (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'e2e-publish-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const remote = join(dir, 'remote.git');
    const cwd = join(dir, 'checkout');
    const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    execFileSync('git', ['init', '--bare', '-q', remote]);
    mkdirSync(cwd);
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    writeFileSync(join(cwd, 'seed'), 'seed'); git('add', '.'); git('commit', '-qm', 'seed');
    git('remote', 'add', 'origin', remote); git('push', '-q', 'origin', 'HEAD:e2e-diffs');
    const count = join(dir, 'attempts');
    writeFileSync(count, '0');
    writeFileSync(join(remote, 'hooks/pre-receive'), `#!/bin/sh
count=$(cat '${count}')
count=$((count + 1))
printf '%s' "$count" > '${count}'
${scenario === 'rejected' ? 'exit 1' : scenario === 'retry' ? '[ "$count" -gt 1 ]' : 'exit 0'}
`);
    chmodSync(join(remote, 'hooks/pre-receive'), 0o755);
    mkdirSync(join(cwd, 'report/images'), { recursive: true });
    writeFileSync(join(cwd, 'report/images/test.png'), 'image');
    const step = workflow.jobs['e2e-report'].steps.find((step: any) => step.name === 'Publish the images');
    const result = spawnSync('bash', ['-e', '-c', step.run], { cwd, encoding: 'utf8', env: {
      ...process.env, RUNNER_TEMP: dir, IMAGES: 'pr-23/run-9', PR: '23', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
    } });
    assert.equal(result.status, scenario === 'rejected' ? 1 : 0, result.stderr);
    assert.equal(Number(readFileSync(count, 'utf8')), scenario === 'rejected' ? 3 : scenario === 'retry' ? 2 : 1);
    if (scenario === 'rejected') assert.match(result.stdout, /Could not publish/);
    else assert.equal(git('--git-dir', remote, 'show', 'refs/heads/e2e-diffs:pr-23/run-9/test.png'), 'image');
  });
}

test('e2e workflow wires dispatch targets and gates comments on image publication', () => {
  const targets = workflow.jobs['e2e-report-targets'];
  assert.match(targets.if, /workflow_dispatch/);
  assert.equal(targets.steps.at(-1).run, 'node scripts/e2e-report-targets.ts');
  const report = workflow.jobs['e2e-report'];
  assert.deepEqual(report.needs, ['e2e', 'e2e-report-targets']);
  assert.equal(report.env.PR, '${{ matrix.pr }}');
  assert.equal(report.strategy.matrix.pr, '${{ fromJSON(needs.e2e-report-targets.outputs.prs) }}');
  const publishIndex = report.steps.findIndex((step: any) => step.name === 'Publish the images');
  const commentIndex = report.steps.findIndex((step: any) => step.name === 'Comment on the pull request');
  assert.ok(commentIndex > publishIndex);
  assert.equal(report.steps[publishIndex]['continue-on-error'], undefined);
  assert.equal(report.steps[commentIndex].if, undefined);
});
