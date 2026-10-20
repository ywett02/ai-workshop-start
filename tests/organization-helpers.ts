import { createWebServer } from '../src/server.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { API, githubRecording, skill } from './scenarios.ts';
import { listen } from './web-helpers.ts';

export const ORG = 'Example';
export const orgUrl = `${API}/orgs/${ORG}`;
export const pageUrl = (page = 1) => `${orgUrl}/repos?type=all&per_page=100&page=${page}`;
export const PATH = '.agents/skills/check/SKILL.md';
export function organizationRecording(): Recording {
  return {
    [orgUrl]: { status: 200, body: { login: ORG } },
    [pageUrl()]: { status: 200, body: ['zeta', 'empty', 'alpha', 'broken'].map((name) => ({ full_name: `${ORG}/${name}`, default_branch: 'main' })) },
    ...githubRecording(`${ORG}/alpha`, { [PATH]: skill('Shared', '<script>window.pwned=true</script>') }),
    ...githubRecording(`${ORG}/zeta`, { [PATH]: skill('Shared', 'Second repository.') }),
    ...githubRecording(`${ORG}/empty`, {}),
    [`${API}/repos/${ORG}/broken/commits/main`]: { status: 404, body: { message: 'Not Found' } },
  };
}
export async function organizationFixture(recording = organizationRecording(), token?: string) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const recorded = replay(recording);
  const server = createWebServer({ github: { token, fetch: async (url, init) => {
    calls.push({ url, headers: init?.headers });
    return recorded(url, init);
  } } });
  return { ...await listen(server), calls };
}
