// Find same-repository PRs for both ordinary PR CI and baseline acceptance's dispatched CI.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'));
const repository = process.env.GITHUB_REPOSITORY!;
let prs: number[] = [];
if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
  if (event.pull_request.head.repo?.full_name === repository) prs = [event.pull_request.number];
} else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && process.env.GITHUB_REF_TYPE === 'branch') {
  const head = `${repository.split('/')[0]}:${process.env.GITHUB_REF_NAME}`;
  const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp',
    `repos/${repository}/pulls?state=open&head=${encodeURIComponent(head)}&per_page=100`], { encoding: 'utf8' }));
  prs = pages.flat().filter((pr: any) => pr.head.repo?.full_name === repository &&
    pr.head.ref === process.env.GITHUB_REF_NAME && pr.head.sha === process.env.GITHUB_SHA).map((pr: any) => pr.number);
}
appendFileSync(process.env.GITHUB_OUTPUT!, `prs=${JSON.stringify(prs)}\n`);
