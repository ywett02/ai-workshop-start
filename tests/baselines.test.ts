import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, chmod, readFile, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'yaml';

const script = fileURLToPath(new URL('../scripts/check-baselines.ts', import.meta.url));
const repo = 'Test/project';
const runs = `repos/${repo}/actions/workflows/update-screenshots.yml/runs?per_page=100`;
const artifacts = `repos/${repo}/actions/runs/42/artifacts?per_page=100`;
const run = { id: 42, path: '.github/workflows/update-screenshots.yml', repository: { full_name: repo }, event: 'pull_request' };

type Answers = Record<string, unknown>;
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const cwd = await mkdtemp(join(tmpdir(), 'atlas-baselines-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Human');
  git('config', 'user.email', 'human@example.invalid');
  const directory = join(cwd, 'e2e/__screenshots__');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'test image.png');
  await writeFile(path, 'original');
  const commit = (author = 'Human') => {
    git('add', '--all');
    git('-c', `user.name=${author}`, 'commit', '-qm', 'test change');
    return git('rev-parse', 'HEAD');
  };
  const base = commit();
  const bin = await mkdtemp(join(tmpdir(), 'atlas-gh-'));
  t.after(() => rm(bin, { recursive: true, force: true }));
  // Stub only GitHub's transport. The CI script and Git commands run unchanged.
  const gh = join(bin, 'gh');
  await writeFile(gh, `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
if (args.slice(0, 3).join(' ') !== 'api --paginate --slurp' || args.length !== 4) process.exit(2);
fs.appendFileSync(process.env.CALLS, args.at(-1) + '\\n');
const answers = JSON.parse(fs.readFileSync(process.env.ANSWERS, 'utf8'));
if (!(args.at(-1) in answers)) { process.stderr.write('API unavailable'); process.exit(1); }
process.stdout.write(JSON.stringify(answers[args.at(-1)]));\n`);
  await chmod(gh, 0o755);
  const calls = join(bin, 'calls');
  async function check(answers: Answers = {}) {
    await writeFile(join(bin, 'answers'), JSON.stringify(answers));
    await writeFile(calls, '');
    const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: {
      ...process.env, PATH: bin + delimiter + process.env.PATH, BASE: base, HEAD: git('rev-parse', 'HEAD'),
      GITHUB_REPOSITORY: repo, ANSWERS: join(bin, 'answers'), CALLS: calls,
    } });
    return { ...result, calls: await readFile(calls, 'utf8') };
  }
  return { cwd, git, path, commit, base, check };
}
function evidence(sha: string): Answers {
  return { [runs]: [{ workflow_runs: [run] }], [artifacts]: [{ artifacts: [{ name: `baseline-commit-${sha}`, expired: false }] }] };
}

test('baseline guard passes unchanged images without GitHub access', async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, 'README.md'), 'unrelated');
  f.commit();
  const result = await f.check();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls, '');
});

for (const author of ['Human', 'github-actions[bot]']) {
  test(`baseline guard rejects local changes by ${author}`, async (t) => {
    const f = await fixture(t);
    await writeFile(f.path, 'changed');
    f.commit(author);
    const result = await f.check({ [runs]: [{ workflow_runs: [] }] });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /test image.png.*no Update screenshots workflow provenance/);
  });
}

test('baseline guard accepts workflow commits across API pages and later unrelated commits', async (t) => {
  const f = await fixture(t);
  await writeFile(f.path, 'rendered');
  const sha = f.commit('github-actions[bot]');
  await writeFile(join(f.cwd, 'README.md'), 'later unrelated change');
  f.commit();
  const answers = evidence(sha);
  answers[runs] = [{ workflow_runs: [] }, { workflow_runs: [run] }];
  answers[artifacts] = [{ artifacts: [] }, { artifacts: [{ name: `baseline-commit-${sha}`, expired: false }] }];
  const result = await f.check(answers);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /actions\/runs\/42\/artifacts/);
});

for (const kind of ['wrong-sha', 'expired', 'wrong-workflow', 'wrong-repository', 'wrong-event', 'api-failure', 'missing-record']) {
  test(`baseline guard rejects ${kind} evidence`, async (t) => {
    const f = await fixture(t);
    await writeFile(f.path, 'changed');
    const sha = f.commit('github-actions[bot]');
    const answers = evidence(sha);
    if (kind === 'wrong-sha') answers[artifacts] = [{ artifacts: [{ name: `baseline-commit-${f.base}`, expired: false }] }];
    if (kind === 'expired') answers[artifacts] = [{ artifacts: [{ name: `baseline-commit-${sha}`, expired: true }] }];
    if (kind === 'wrong-workflow') answers[runs] = [{ workflow_runs: [{ ...run, path: '.github/workflows/other.yml' }] }];
    if (kind === 'wrong-repository') answers[runs] = [{ workflow_runs: [{ ...run, repository: { full_name: 'Other/repo' } }] }];
    if (kind === 'wrong-event') answers[runs] = [{ workflow_runs: [{ ...run, event: 'push' }] }];
    if (kind === 'api-failure') delete answers[artifacts];
    if (kind === 'missing-record') answers[artifacts] = [{ artifacts: [] }];
    assert.equal((await f.check(answers)).status, 1);
  });
}

for (const change of ['edit', 'addition', 'deletion', 'rename']) {
  test(`baseline guard rejects a local ${change} after workflow acceptance`, async (t) => {
    const f = await fixture(t);
    await writeFile(f.path, 'rendered');
    const accepted = f.commit();
    if (change === 'edit') await writeFile(f.path, 'local edit');
    if (change === 'addition') await writeFile(join(f.cwd, 'e2e/__screenshots__/new image.png'), 'new');
    if (change === 'deletion') await unlink(f.path);
    if (change === 'rename') await rename(f.path, join(f.cwd, 'e2e/__screenshots__/renamed image.png'));
    f.commit('github-actions[bot]');
    assert.equal((await f.check(evidence(accepted))).status, 1);
  });
}

test('CI invokes the tested guard and updater records the pushed SHA before dispatch', async (t) => {
  const ci = parse(await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  assert.equal(ci.jobs.baselines.steps.at(-1).run, 'node scripts/check-baselines.ts');
  assert.equal(ci.jobs.baselines.permissions.actions, 'read');
  const updater = parse(await readFile(new URL('../.github/workflows/update-screenshots.yml', import.meta.url), 'utf8'));
  const steps = updater.jobs.commit.steps;
  const commitStep = steps.find((step: any) => step.id === 'baselines');
  const uploadIndex = steps.findIndex((step: any) => step.with?.name === 'baseline-commit-${{ steps.baselines.outputs.commit }}');
  assert.ok(uploadIndex > steps.indexOf(commitStep));
  assert.ok(uploadIndex < steps.findIndex((step: any) => step.name === 'Start CI for the accepted commit'));
  // Execute the actual publishing shell with a real local remote, then verify its record.
  const f = await fixture(t);
  const remote = join(f.cwd, 'remote.git');
  execFileSync('git', ['init', '--bare', '-q', remote]);
  f.git('remote', 'add', 'origin', remote);
  await writeFile(f.path, 'rendered');
  const output = join(f.cwd, 'step-output');
  const result = spawnSync('bash', ['-e', '-c', commitStep.run], { cwd: f.cwd, encoding: 'utf8', env: {
    ...process.env, BRANCH: 'accepted', GITHUB_OUTPUT: output, RUNNER_TEMP: f.cwd,
  } });
  assert.equal(result.status, 0, result.stderr);
  const sha = f.git('rev-parse', 'HEAD');
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/accepted').split(/\s/)[0], sha);
  assert.match(await readFile(output, 'utf8'), new RegExp(`commit=${sha}`));
  assert.equal(await readFile(join(f.cwd, 'baseline-commit.txt'), 'utf8'), `${sha}\n`);
  await unlink(output);
  const unchanged = spawnSync('bash', ['-e', '-c', commitStep.run], { cwd: f.cwd, encoding: 'utf8', env: {
    ...process.env, BRANCH: 'accepted', GITHUB_OUTPUT: output, RUNNER_TEMP: f.cwd,
  } });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(f.git('rev-parse', 'HEAD'), sha);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
