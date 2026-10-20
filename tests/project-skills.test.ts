// Acceptance coverage for spec/analysis.md and spec/cli.md, through real local scans.
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { scan } from '../src/core/scan.ts';
import { openDirectory } from '../src/local.ts';
import { localRepository, ROOTS, scanLocal, skill } from './scenarios.ts';

function link(root: string, path: string): string {
  return pathToFileURL(join(root, path)).href;
}

test('MPS: identical agent copies count once, use the canonical link, and print also in', (t) => {
  const first = '.agents/skills/mps-tests/SKILL.md';
  const second = '.claude/skills/mps-tests/SKILL.md';
  const root = localRepository(t, { [second]: skill('mps-tests'), [first]: skill('mps-tests') });
  assert.deepEqual(scanLocal(root), {
    code: 0,
    stdout: `project · 1 skill\nmps-tests — Check the project.\n  ${link(root, first)}\n  also in ${second}`,
    stderr: '',
  });
});

for (const agentRoot of ROOTS) {
  const label = agentRoot === 'agent/skills' ? "Android's unusual agent/skills folder" : `allowed root ${agentRoot}`;
  test(`accept ${label}`, (t) => {
    const path = `${agentRoot}/writing-lint-checks/SKILL.md`;
    const root = localRepository(t, { [path]: skill('writing-lint-checks') });
    assert.deepEqual(scanLocal(root), {
      code: 0, stdout: `project · 1 skill\nwriting-lint-checks — Check the project.\n  ${link(root, path)}`, stderr: '',
    });
  });
}

const excluded = [
  ['MPS product skill', 'plugins/mcp-tools/resources/bundled/skills/mps-aspect-generator/SKILL.md'],
  ['koog test data', 'integration-tests/src/jvmTest/resources/skills/weather-retrieval/SKILL.md'],
  ['custom folder', 'developer-workflows/release/SKILL.md'],
  ['nested module root', 'modules/compiler/.agents/skills/check/SKILL.md'],
  ['repository entry point', 'SKILL.md'],
  ['extra directory below a root', '.agents/skills/group/check/SKILL.md'],
  ['missing skill directory', '.agents/skills/SKILL.md'],
  ['root prefix lookalike', '.agents/skills-extra/check/SKILL.md'],
  ['root under test data', 'fixtures/.claude/skills/check/SKILL.md'],
  ['root under product resources', 'plugins/tool/resources/.agents/skills/check/SKILL.md'],
  ['wrong root case', '.Agents/skills/check/SKILL.md'],
  ['lowercase filename', '.agents/skills/check/skill.md'],
  ['uppercase extension', '.agents/skills/check/SKILL.MD'],
] as const;

for (const [label, path] of excluded) {
  test(`exclude ${label}: ${path}`, (t) => {
    const root = localRepository(t, { [path]: skill('excluded') });
    assert.deepEqual(scanLocal(root), { code: 0, stdout: 'project · 0 skills', stderr: '' });
  });
}

test('excluded malformed files produce no metadata warnings', (t) => {
  // Case variants are tested separately: a combined fixture aliases them on macOS.
  const root = localRepository(t, Object.fromEntries(excluded.slice(0, 10).map(([, path]) => [path, '---\nname: [broken\n---\n'])));
  const result = scanLocal(root);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, '');
});

test('excluded paths never become copies of a project skill with matching content', (t) => {
  const path = '.agents/skills/check/SKILL.md';
  const root = localRepository(t, {
    [path]: skill(),
    'plugins/tool/resources/skills/check/SKILL.md': skill(),
    'fixtures/.claude/skills/check/SKILL.md': skill(),
  });
  assert.deepEqual(scanLocal(root), {
    code: 0, stdout: `project · 1 skill\ncheck — Check the project.\n  ${link(root, path)}`, stderr: '',
  });
});

test('all four roots group by directory name, with sorted canonical and copy paths', (t) => {
  const paths = ROOTS.map((root) => `${root}/check/SKILL.md`);
  const root = localRepository(t, Object.fromEntries([...paths].reverse().map((path) => [path, skill()])));
  assert.deepEqual(scanLocal(root), {
    code: 0,
    stdout: `project · 1 skill\ncheck — Check the project.\n  ${link(root, paths[0])}\n  also in ${paths.slice(1).join(', ')}`,
    stderr: '',
  });
});

test('conflicting copies still count once and use canonical metadata with a warning', (t) => {
  const canonical = '.agents/skills/check/SKILL.md';
  const copy = '.claude/skills/check/SKILL.md';
  const root = localRepository(t, {
    [copy]: skill('other-display-name', 'Other instructions.'),
    [canonical]: skill('canonical-display-name', 'Canonical instructions. More detail.'),
  });
  const result = scanLocal(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `project · 1 skill\ncanonical-display-name — Canonical instructions.\n  ${link(root, canonical)}\n  also in ${copy}`);
  assert.match(result.stderr, /^warning: /);
  assert.match(result.stderr, /conflict|differ|mismatch/i);
});

test('malformed canonical metadata keeps canonical identity rather than promoting a valid copy', (t) => {
  const canonical = '.agents/skills/check/SKILL.md';
  const copy = '.claude/skills/check/SKILL.md';
  const root = localRepository(t, {
    [canonical]: '---\nname: [broken\n---\n',
    [copy]: skill('other-display-name'),
  });
  const result = scanLocal(root);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, `project · 1 skill\ncheck\n  ${link(root, canonical)}\n  also in ${copy}`);
  assert.match(result.stderr, /^warning: /);
  assert.ok(result.stderr.includes(canonical), result.stderr);
  assert.match(result.stderr, /malformed/i);
  assert.match(result.stderr, /conflict|differ|mismatch/i);
});

test('different supporting scripts do not split a skill or trigger a SKILL.md conflict', (t) => {
  const root = localRepository(t, {
    '.agents/skills/check/SKILL.md': skill(),
    '.agents/skills/check/scripts/run.sh': 'echo first\n',
    '.claude/skills/check/SKILL.md': skill(),
    '.claude/skills/check/scripts/run.sh': 'echo second\n',
  });
  const result = scanLocal(root);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.split('\n')[0], 'project · 1 skill');
  assert.match(result.stdout, /also in \.claude\/skills\/check\/SKILL\.md$/);
  assert.equal(result.stderr, '');
});

test('different directory names remain separate despite identical metadata and contents; ties sort by path', (t) => {
  const first = '.agents/skills/z-directory/SKILL.md';
  const second = '.claude/skills/a-directory/SKILL.md';
  const root = localRepository(t, { [second]: skill('shared'), [first]: skill('shared') });
  assert.deepEqual(scanLocal(root), {
    code: 0,
    stdout: `project · 2 skills\nshared — Check the project.\n  ${link(root, first)}\nshared — Check the project.\n  ${link(root, second)}`,
    stderr: '',
  });
});

test('directory-name identity is case-sensitive across roots', (t) => {
  const root = localRepository(t, {
    '.agents/skills/Check/SKILL.md': skill('shared'),
    '.claude/skills/check/SKILL.md': skill('shared'),
  });
  const result = scanLocal(root);
  assert.equal(result.code, 0);
  assert.equal(result.stdout.split('\n')[0], 'project · 2 skills');
  assert.doesNotMatch(result.stdout, /also in/);
});

test('display names sort case-sensitively using locale-independent ordering', (t) => {
  const upper = '.claude/skills/upper/SKILL.md';
  const lower = '.agents/skills/lower/SKILL.md';
  const root = localRepository(t, { [lower]: skill('alpha'), [upper]: skill('Zeta') });
  assert.deepEqual(scanLocal(root), {
    code: 0,
    stdout: `project · 2 skills\nZeta — Check the project.\n  ${link(root, upper)}\nalpha — Check the project.\n  ${link(root, lower)}`,
    stderr: '',
  });
});

test('the model uses the canonical path for identity and retains full descriptions', async (t) => {
  const canonical = '.agents/skills/check/SKILL.md';
  const copy = '.claude/skills/check/SKILL.md';
  const root = localRepository(t, { [copy]: skill('display'), [canonical]: skill('display') });
  const result = await scan(await openDirectory(root));
  assert.deepEqual(result.skills, [{
    id: `project:${canonical}`, repository: 'project', path: canonical, name: 'display',
    description: 'Check the project. Run before committing.', commit: '', copies: [copy],
  }]);
  assert.deepEqual(result.warnings, []);
});

test('symbolic-link entry points and skill directories are not followed', (t) => {
  const root = localRepository(t, { 'instructions.md': skill() });
  const fileLink = join(root, '.agents/skills/file-link/SKILL.md');
  mkdirSync(dirname(fileLink), { recursive: true });
  symlinkSync(join(root, 'instructions.md'), fileLink);
  const external = join(root, '..', 'external');
  mkdirSync(external);
  writeFileSync(join(external, 'SKILL.md'), skill());
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  symlinkSync(external, join(root, '.claude/skills/directory-link'), 'dir');
  assert.deepEqual(scanLocal(root), { code: 0, stdout: 'project · 0 skills', stderr: '' });
});

test('an empty repository succeeds with zero skills', (t) => {
  assert.deepEqual(scanLocal(localRepository(t)), { code: 0, stdout: 'project · 0 skills', stderr: '' });
});

for (const [label, contents] of [
  ['missing front matter', '# Check\n'],
  ['unclosed front matter', '---\nname: display\n'],
  ['malformed YAML', '---\nname: [broken\n---\n'],
  ['non-mapping front matter', '---\n- display\n---\n'],
] as const) {
  test(`${label}: warn, use the directory name, and keep scanning`, (t) => {
    const path = '.agents/skills/fallback/SKILL.md';
    const good = '.claude/skills/good/SKILL.md';
    const root = localRepository(t, { [path]: contents, [good]: skill('good') });
    const result = scanLocal(root);
    assert.equal(result.code, 0);
    assert.equal(result.stdout, `project · 2 skills\nfallback\n  ${link(root, path)}\ngood — Check the project.\n  ${link(root, good)}`);
    assert.match(result.stderr, /^warning: \.agents\/skills\/fallback\/SKILL\.md: /);
  });
}

for (const [label, contents, display] of [
  ['missing name', '---\ndescription: Check it.\n---\n', 'fallback — Check it.'],
  ['empty name', '---\nname: "  "\ndescription: Check it.\n---\n', 'fallback — Check it.'],
  ['missing description', '---\nname: display\n---\n', 'display'],
] as const) {
  test(`${label}: use metadata fallbacks without warning`, (t) => {
    const path = '.agents/skills/fallback/SKILL.md';
    const root = localRepository(t, { [path]: contents });
    assert.deepEqual(scanLocal(root), { code: 0, stdout: `project · 1 skill\n${display}\n  ${link(root, path)}`, stderr: '' });
  });
}
