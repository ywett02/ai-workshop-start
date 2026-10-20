import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestContext } from 'node:test';
import { openGitHub, type Fetch } from '../src/core/github.ts';
import { replay, type Recorded, type Recording } from '../src/core/replay.ts';
import { CLI, EXAMPLE_COMMIT, runAtlas } from './helpers.ts';

export const ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];
export const API = 'https://api.github.com';

export function skill(name = 'check', description = 'Check the project. Run before committing.'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n# Instructions\n`;
}

/** A real, isolated checkout. All files, including symlink targets, are cleaned up. */
export function localRepository(t: TestContext, files: Record<string, string> = {}): string {
  const temporary = mkdtempSync(join(tmpdir(), 'skill-atlas-spec-'));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, 'project');
  mkdirSync(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

/** Exercise the actual executable, including stdout, stderr, and exit status. */
export function scanLocal(root: string) {
  const result = spawnSync(process.execPath, [CLI, 'scan', root], { encoding: 'utf8' });
  assert.ifError(result.error);
  return { code: result.status, stdout: result.stdout.trimEnd(), stderr: result.stderr.trimEnd() };
}

export function rawUrl(id: string, path: string): string {
  return `https://raw.githubusercontent.com/${id}/${EXAMPLE_COMMIT}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function searchUrl(id: string, page = 1): string {
  return `${API}/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=${page}`;
}

export type TreeEntry = { path: string; mode: string; type: string; sha: string };
export type GitTree = { truncated: boolean; tree: TreeEntry[] };

/**
 * Small GitHub recordings, with both recursive and per-directory trees available.
 * Tests can change an individual answer to simulate truncation or read failures.
 * No unrecorded request ever reaches the network.
 */
export function githubRecording(
  id: string,
  files: Record<string, string | Recorded>,
  modes: Record<string, string> = {},
): Recording {
  const hash = (text: string) => createHash('sha1').update(text).digest('hex');
  const recording: Recording = {
    [`${API}/repos/${id}`]: { status: 200, body: { full_name: id, default_branch: 'main' } },
    [`${API}/repos/${id}/commits/main`]: { status: 200, body: { sha: EXAMPLE_COMMIT } },
  };
  const directories = new Set(['']);
  for (const path of Object.keys(files)) {
    const segments = path.split('/');
    for (let length = 1; length < segments.length; length++) directories.add(segments.slice(0, length).join('/'));
  }
  const entries: TreeEntry[] = [...directories].filter(Boolean).map((path) => ({
    path, mode: '040000', type: 'tree', sha: hash(`tree:${path}`),
  }));
  for (const [path, response] of Object.entries(files)) {
    const answer = typeof response === 'string' ? { status: 200, body: response } : response;
    const text = String(answer.body);
    const sha = hash(`blob ${Buffer.byteLength(text)}\0${text}`);
    const mode = modes[path] ?? '100644';
    entries.push({ path, mode, type: 'blob', sha });
    recording[rawUrl(id, path)] = answer;
    // Metadata is available if the scanner verifies a search hit's file type.
    recording[`${API}/repos/${id}/contents/${path}?ref=${EXAMPLE_COMMIT}`] = answer.status === 200 ? {
      status: 200,
      body: { path, sha, type: mode === '120000' ? 'symlink' : 'file', content: Buffer.from(text).toString('base64'), encoding: 'base64' },
    } : answer;
  }
  for (const directory of directories) {
    const sha = directory ? hash(`tree:${directory}`) : EXAMPLE_COMMIT;
    const relative = entries
      .filter((entry) => directory ? entry.path.startsWith(`${directory}/`) : true)
      .map((entry) => ({ ...entry, path: directory ? entry.path.slice(directory.length + 1) : entry.path }));
    recording[`${API}/repos/${id}/git/trees/${sha}`] = {
      status: 200, body: { truncated: false, tree: relative.filter((entry) => !entry.path.includes('/')) },
    };
    recording[`${API}/repos/${id}/git/trees/${sha}?recursive=1`] = {
      status: 200, body: { truncated: false, tree: relative },
    };
  }
  // Code-search hits do not supply the git file mode; it must be verified separately.
  const items = entries
    .filter((entry) => entry.type === 'blob' && entry.path.split('/').at(-1) === 'SKILL.md')
    .map(({ path, sha }) => ({ path, sha, url: `${API}/repos/${id}/contents/${path}?ref=${EXAMPLE_COMMIT}` }));
  for (let page = 1; page <= Math.min(10, Math.max(1, Math.ceil(items.length / 100))); page++) {
    recording[searchUrl(id, page)] = {
      status: 200, body: { total_count: items.length, incomplete_results: false, items: items.slice((page - 1) * 100, page * 100) },
    };
  }
  return recording;
}

export function scanGitHub(id: string, recording: Recording, token?: string, fetch: Fetch = replay(recording)) {
  return runAtlas(['scan', `https://github.com/${id}`], (input) => openGitHub(input, { fetch, token }));
}
