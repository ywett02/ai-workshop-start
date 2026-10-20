import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { AtlasError } from './core/errors.ts';
import { skillLink } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

type Options = { open?: (input: string) => Promise<Source> };
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

/** Local, read-only web client; tokens and repository fetching stay on the server. */
export function createWebServer(options: Options = {}) {
  const open = options.open ?? ((input: string) => openGitHub(input, { fetch, token: process.env.GITHUB_TOKEN || undefined }));
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
        const input = (url.searchParams.get('repository') ?? '').trim();
        if (!parseGitHubUrl(input)) {
          json(400, { error: 'Enter a GitHub repository URL, such as https://github.com/owner/repository.' });
          return;
        }
        const source = await open(input);
        const contents = new Map<string, string>();
        const result = await scan({
          ...source,
          read: async (path) => {
            const bytes = await source.read(path);
            if (bytes) contents.set(path, new TextDecoder().decode(bytes));
            return bytes;
          },
        });
        json(200, {
          ...result,
          skills: result.skills.map((skill) => ({ ...skill, link: skillLink(result.repository, skill), content: contents.get(skill.path) })),
        });
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
        error: error instanceof AtlasError ? error.message : 'Unable to scan the repository. Please try again.',
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
