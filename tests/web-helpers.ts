import type { AddressInfo } from 'node:net';
import { AtlasError } from '../src/core/errors.ts';
import type { Source } from '../src/core/scan.ts';
import { createWebServer } from '../src/server.ts';

export const CONTENT = '---\nname: Alpha\ndescription: First skill. Full description.\n---\n# Alpha\n<script>window.pwned = true</script>\n<img src=x onerror="window.pwned=true">\n';
export const COMMIT = 'a'.repeat(40);
export const FILES: Record<string, string> = {
  '.agents/skills/alpha/SKILL.md': CONTENT,
  '.claude/skills/alpha/SKILL.md': '---\nname: Other copy\n---\nDifferent contents',
  '.github/skills/beta/SKILL.md': '---\nname: Beta\ndescription: Second skill.\n---\n# Beta\nRun the tests.\n',
  'agent/skills/z-broken/SKILL.md': '# Instructions without front matter\n',
};

export async function webFixture(files: Record<string, string> = FILES) {
  const reads: string[] = [];
  const server = createWebServer({ open: async (input) => {
    if (input.endsWith('/missing')) throw new AtlasError('Repository not found: https://github.com/Test/missing');
    if (input.endsWith('/failure')) throw new Error('internal secret');
    const empty = input.endsWith('/empty');
    const source: Source = {
      repository: { id: 'Test/skills', organization: 'Test', name: 'skills', url: 'https://github.com/Test/skills', commit: COMMIT },
      paths: empty ? [] : [...Object.keys(files), '.agents/skills/unreadable/SKILL.md', 'product/skills/ignored/SKILL.md'],
      warnings: empty ? [] : ['GitHub search is incomplete and may omit project skills'],
      read: async (path) => {
        reads.push(path);
        return files[path] === undefined ? undefined : new TextEncoder().encode(files[path]);
      },
    };
    return source;
  } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    reads,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
