// Fixed GitHub answers for the demos, so every run renders the same pages. Nothing reaches the network.
import type { Fetch } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { API, githubRecording } from '../tests/scenarios.ts';

const skill = (name: string, description: string, body: string) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

const RELEASE = skill('release-notes', 'Draft release notes from merged pull requests. Use before tagging a release.',
  '# Release notes\n\n1. List pull requests merged since the last tag.\n2. Group them by area.\n3. Write one line per change, in the past tense.\n');
const REVIEW = skill('code-review', 'Review the current diff for correctness bugs before opening a pull request.',
  '# Code review\n\nRead the diff, then the code it touches. Report only bugs you can reproduce.\n');

export const REPOSITORY = 'Acme/atlas';
export const ORGANIZATION = 'Acme';

export function repositoryRecording(): Recording {
  return githubRecording(REPOSITORY, {
    '.agents/skills/code-review/SKILL.md': REVIEW,
    '.agents/skills/release-notes/SKILL.md': RELEASE,
    '.claude/skills/release-notes/SKILL.md': RELEASE,
    '.claude/skills/flaky-tests/SKILL.md': skill('flaky-tests', 'Find and fix tests that pass and fail without code changes.',
      '# Flaky tests\n\nRun the suspect test twenty times. Look for shared state, timing, and ordering.\n'),
    '.github/skills/dependency-bump/SKILL.md': skill('dependency-bump', 'Update one dependency and fix what breaks. Use for Dependabot pull requests.',
      '# Dependency bump\n\nRead the changelog, update the lockfile, run the tests.\n'),
    'agent/skills/translate-docs/SKILL.md': skill('translate-docs', 'Translate a documentation page and keep code samples unchanged.',
      '# Translate docs\n\nTranslate prose only. Keep links, code, and headings anchors as they are.\n'),
    '.agents/skills/onboarding/SKILL.md': '# Onboarding\n\nThis file has no front matter.\n',
  });
}

export function organizationRecording(): Recording {
  return {
    [`${API}/orgs/${ORGANIZATION}`]: { status: 200, body: { login: ORGANIZATION } },
    [`${API}/orgs/${ORGANIZATION}/repos?type=all&per_page=100&page=1`]: {
      status: 200,
      body: ['website', 'atlas', 'legacy', 'design-system'].map((name) => ({ full_name: `${ORGANIZATION}/${name}`, default_branch: 'main' })),
    },
    ...githubRecording(`${ORGANIZATION}/atlas`, {
      '.agents/skills/code-review/SKILL.md': REVIEW,
      '.agents/skills/release-notes/SKILL.md': RELEASE,
    }),
    ...githubRecording(`${ORGANIZATION}/website`, {
      '.claude/skills/release-notes/SKILL.md': skill('release-notes', 'Write the release blog post from the changelog.',
        '# Release post\n\nSummarize the three biggest changes for users.\n'),
      '.claude/skills/broken-links/SKILL.md': skill('broken-links', 'Find and fix broken links in the published site.',
        '# Broken links\n\nCrawl the build output and fix every 404.\n'),
    }),
    ...githubRecording(`${ORGANIZATION}/design-system`, {}),
    [`${API}/repos/${ORGANIZATION}/legacy/commits/main`]: { status: 404, body: { message: 'Not Found' } },
  };
}

/** Replays a recording; answers for held URLs wait until the test releases them. */
export function heldReplay(recording: Recording) {
  const recorded = replay(recording);
  const holds = new Map<string, Promise<void>>();
  const fetch: Fetch = async (url, init) => {
    await holds.get(url);
    return recorded(url, init);
  };
  const hold = (url: string) => {
    let release!: () => void;
    holds.set(url, new Promise((resolve) => { release = resolve; }));
    return release;
  };
  return { fetch, hold };
}
