import { execFileSync } from 'node:child_process';

const directory = 'e2e/__screenshots__';
const workflow = '.github/workflows/update-screenshots.yml';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/** Read all API pages; a failed lookup must never accept unverified baselines. */
function pages(endpoint: string): Record<string, any>[] {
  return JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8' }));
}

function check() {
  const { BASE, HEAD, GITHUB_REPOSITORY } = process.env;
  if (!BASE || !HEAD || !GITHUB_REPOSITORY) throw new Error('BASE, HEAD and GITHUB_REPOSITORY are required');
  const files = execFileSync('git', ['diff', '--name-only', '-z', `${BASE}...${HEAD}`, '--', directory], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  if (!files.length) {
    console.log('No changed screenshot baselines.');
    return;
  }
  const commits = new Map(files.map((file) => [file, git('log', '-1', '--format=%H', `${BASE}..${HEAD}`, '--', file)]));
  const accepted = new Set<string>();
  // The artifact name is GitHub-hosted evidence emitted only after the workflow pushes
  // its exact commit. Git author names and commit-message trailers are not evidence.
  const runs = pages(`repos/${GITHUB_REPOSITORY}/actions/workflows/update-screenshots.yml/runs?per_page=100`)
    .flatMap((page) => page.workflow_runs);
  for (const run of runs) {
    if (run.path !== workflow || run.repository?.full_name !== GITHUB_REPOSITORY ||
        !['pull_request', 'workflow_dispatch'].includes(run.event)) continue;
    for (const artifact of pages(`repos/${GITHUB_REPOSITORY}/actions/runs/${run.id}/artifacts?per_page=100`).flatMap((page) => page.artifacts)) {
      const match = /^baseline-commit-([a-f0-9]{40})$/.exec(artifact.name);
      if (match && !artifact.expired) accepted.add(match[1]);
    }
    if ([...commits.values()].every((sha) => accepted.has(sha))) break;
  }
  const rejected = [...commits].filter(([, sha]) => !accepted.has(sha));
  if (rejected.length) {
    for (const [file, sha] of rejected) console.error(`${file}: commit ${sha} has no Update screenshots workflow provenance.`);
    throw new Error('Restore unaccepted baselines and use the update-screenshots label to accept them.');
  }
  console.log(`Verified workflow provenance for ${files.length} screenshot baseline(s).`);
}

try { check(); } catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to verify baseline provenance');
  process.exitCode = 1;
}
