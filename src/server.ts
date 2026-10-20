import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { listGitHubOrganization, openGitHub, parseGitHubOrganization, parseGitHubUrl, type GitHubOptions, type KnownRepository } from './core/github.ts';
import { AtlasError } from './core/errors.ts';
import { skillLink } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

type Options = { open?: (input: string, known?: KnownRepository) => Promise<Source>; github?: GitHubOptions };
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

/** Local, read-only web client; tokens and repository fetching stay on the server. */
export function createWebServer(options: Options = {}) {
  const github = options.github ?? { fetch, token: process.env.GITHUB_TOKEN || undefined };
  const open = options.open ?? ((input: string, known?: KnownRepository) =>
    // One repository at a time can afford code search; a whole organization cannot.
    openGitHub(input, known ? { ...github, search: false } : github, known));
  async function scanRepository(input: string, known?: KnownRepository) {
    const source = await open(input, known);
    const contents = new Map<string, string>();
    const result = await scan({
      ...source,
      read: async (path) => {
        const bytes = await source.read(path);
        if (bytes) contents.set(path, new TextDecoder().decode(bytes));
        return bytes;
      },
    });
    return {
      ...result,
      skills: result.skills.map((skill) => ({ ...skill, link: skillLink(result.repository, skill), content: contents.get(skill.path) })),
    };
  }
  async function scanOrganization(input: string) {
    const listing = await listGitHubOrganization(input, github);
    const results = new Map<string, Awaited<ReturnType<typeof scanRepository>>>();
    const failures = new Map<string, string>();
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, listing.repositories.length) }, async () => {
      while (next < listing.repositories.length) {
        const index = next++;
        const id = listing.repositories[index];
        try {
          results.set(id, await scanRepository(`https://github.com/${id}`, listing.known[index]));
        } catch (error) {
          const message = error instanceof AtlasError ? error.message : 'Unable to scan repository. Please try again.';
          failures.set(id, `${id}: ${message}; skipped; results may omit project skills`);
        }
      }
    }));
    const repositories = listing.repositories.flatMap((id) => results.has(id) ? [results.get(id)!] : []);
    return {
      organization: listing.organization,
      repositoryCount: listing.repositories.length,
      repositories,
      skills: repositories.flatMap((result) => result.skills),
      warnings: [...listing.warnings, ...listing.repositories.flatMap((id) =>
        failures.has(id) ? [failures.get(id)!] : results.get(id)!.warnings.map((warning) => `${id}: ${warning}`))],
    };
  }
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    try {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        json(405, { error: 'Method not allowed' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname === '/api/scan') {
        if (url.searchParams.has('organization')) {
          const input = (url.searchParams.get('organization') ?? '').trim();
          if (url.searchParams.has('repository') || !parseGitHubOrganization(input)) {
            json(400, { error: 'Enter a GitHub organization name or URL, such as https://github.com/JetBrains. Choose only one scan target.' });
            return;
          }
          json(200, await scanOrganization(input));
          return;
        }
        const input = (url.searchParams.get('repository') ?? '').trim();
        if (!parseGitHubUrl(input)) {
          json(400, { error: 'Enter a GitHub repository URL, such as https://github.com/owner/repository.' });
          return;
        }
        json(200, await scanRepository(input));
        return;
      }
      const asset = assets.get(url.pathname);
      if (!asset) {
        json(404, { error: 'Not found' });
        return;
      }
      const bytes = await readFile(new URL(`./web/${asset[0]}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': asset[1] });
      response.end(bytes);
    } catch (error) {
      json(error instanceof AtlasError ? 502 : 500, {
        error: error instanceof AtlasError ? error.message : 'Unable to scan the repository or organization. Please try again.',
      });
    }
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
  const server = createWebServer();
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') console.log(`Skill Atlas: http://127.0.0.1:${address.port}`);
  });
}
