import { createServer, type ServerResponse } from 'node:http';
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

/** Validate the written calendar date before Date.parse can normalize overflow days. */
function historyDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = parts;
  const y = Number(year);
  const m = Number(month);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || Number(day) < 1 || Number(day) > days[m - 1]
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
    || (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))) return null;
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

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
    // History is optional enrichment. Bound requests and keep skills usable if it fails.
    const skills = [];
    for (let index = 0; index < result.skills.length; index += 4) {
      const batch = await Promise.all(result.skills.slice(index, index + 4).map(async (skill) => {
        let lastUpdated: string | null = null;
        try {
          const date = await source.lastUpdated?.(skill.path);
          lastUpdated = historyDate(date);
        } catch {
          // Do not expose unexpected errors or credentials in warnings.
        }
        return { ...skill, lastUpdated, link: skillLink(result.repository, skill), content: contents.get(skill.path) };
      }));
      skills.push(...batch);
    }
    for (const skill of skills) {
      if (!skill.lastUpdated) result.warnings.push(`${skill.path}: last updated date unavailable`);
    }
    return { ...result, skills };
  }
  type RepositoryScan = { id: string; result?: Awaited<ReturnType<typeof scanRepository>>; warnings: string[] };
  /** At most four repositories at a time; each is reported as soon as it is done. */
  async function scanRepositories(
    listing: Awaited<ReturnType<typeof listGitHubOrganization>>,
    report: (scan: RepositoryScan) => void,
    cancelled = () => false,
  ) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, listing.repositories.length) }, async () => {
      while (next < listing.repositories.length && !cancelled()) {
        const index = next++;
        const id = listing.repositories[index];
        let scan: RepositoryScan;
        try {
          const result = await scanRepository(`https://github.com/${id}`, listing.known[index]);
          scan = { id, result, warnings: result.warnings.map((warning) => `${id}: ${warning}`) };
        } catch (error) {
          const message = error instanceof AtlasError ? error.message : 'Unable to scan repository. Please try again.';
          scan = { id, warnings: [`${id}: ${message}; skipped; results may omit project skills`] };
        }
        report(scan);
      }
    }));
  }
  async function scanOrganization(input: string) {
    const listing = await listGitHubOrganization(input, github);
    const scans = new Map<string, RepositoryScan>();
    await scanRepositories(listing, (scan) => scans.set(scan.id, scan));
    const repositories = listing.repositories.flatMap((id) => scans.get(id)!.result ?? []);
    return {
      organization: listing.organization,
      repositoryCount: listing.repositories.length,
      repositories,
      skills: repositories.flatMap((result) => result.skills),
      warnings: [...listing.warnings, ...listing.repositories.flatMap((id) => scans.get(id)!.warnings)],
    };
  }
  /** One JSON line per event, so the page can show repositories while the rest are scanned. */
  async function streamOrganization(input: string, response: ServerResponse) {
    // A page that leaves closes the scan, even while repositories are still being listed;
    // stop starting repositories for it.
    let closed = false;
    response.on('close', () => { closed = true; });
    const listing = await listGitHubOrganization(input, github);
    if (closed) return;
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
    const line = (event: unknown) => response.write(`${JSON.stringify(event)}\n`);
    line({ type: 'start', organization: listing.organization, repositoryCount: listing.repositories.length, warnings: listing.warnings });
    await scanRepositories(listing, (scan) => line({ type: 'repository', ...scan }), () => closed);
    response.end(`${JSON.stringify({ type: 'done' })}\n`);
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
          if (request.headers.accept?.includes('application/x-ndjson')) await streamOrganization(input, response);
          else json(200, await scanOrganization(input));
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
      if (response.headersSent) {
        response.destroy();
        return;
      }
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
