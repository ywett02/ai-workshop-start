// Runs the commands the way the CLI does, with GitHub answering from EXAMPLE below.
import { fileURLToPath } from 'node:url';
import { run, type Context } from '../src/commands.ts';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openDirectory } from '../src/local.ts';

export const FIXTURE = fileURLToPath(new URL('../fixture', import.meta.url));
export const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** The commit GitHub answers for JetBrains/example. */
export const EXAMPLE_COMMIT = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

/** What GitHub answers for a small repository, JetBrains/example, with one skill. */
const EXAMPLE: Recording = {
  'https://api.github.com/repos/JetBrains/example': { status: 200, body: { full_name: 'JetBrains/example', default_branch: 'main' } },
  'https://api.github.com/repos/JetBrains/example/commits/main': { status: 200, body: { sha: EXAMPLE_COMMIT } },
  'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1': {
    status: 200,
    body: { total_count: 1, items: [{ path: '.claude/skills/commits/SKILL.md' }] },
  },
  [`https://api.github.com/repos/JetBrains/example/git/trees/${EXAMPLE_COMMIT}`]: {
    status: 200, body: { truncated: false, tree: [{ path: '.claude', type: 'tree', mode: '040000', sha: 'claude-tree' }] },
  },
  'https://api.github.com/repos/JetBrains/example/git/trees/claude-tree': {
    status: 200, body: { truncated: false, tree: [{ path: 'skills', type: 'tree', mode: '040000', sha: 'skills-tree' }] },
  },
  'https://api.github.com/repos/JetBrains/example/git/trees/skills-tree': {
    status: 200, body: { truncated: false, tree: [{ path: 'commits', type: 'tree', mode: '040000', sha: 'commits-tree' }] },
  },
  'https://api.github.com/repos/JetBrains/example/git/trees/commits-tree': {
    status: 200, body: { truncated: false, tree: [{ path: 'SKILL.md', type: 'blob', mode: '100644', sha: 'commits-blob' }] },
  },
  [`https://raw.githubusercontent.com/JetBrains/example/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`]: {
    status: 200,
    body: '---\nname: commits\ndescription: Write commit messages the way this repository does. Use for every commit.\n---\n# Commits\n',
  },
};

const github = replay(EXAMPLE);

/** `skill-atlas <args>`, as the CLI runs it, with GitHub answering from EXAMPLE. */
export async function atlas(args: string[]) {
  return runAtlas(args, (input) =>
    parseGitHubUrl(input) ? openGitHub(input, { fetch: github, token: 'test' }) : openDirectory(input),
  );
}

/** The real command dispatcher with a local or recorded repository source. */
export async function runAtlas(args: string[], open: Context['open']) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    open,
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
