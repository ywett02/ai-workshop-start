/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** Exact project entry points, grouped by directory name in path order. */
export function findSkills(paths: string[], _repositoryName: string): SkillFile[] {
  const groups = new Map<string, SkillFile>();
  for (const path of [...new Set(paths)].sort()) {
    const segments = path.split('/');
    if (segments.length !== 4 || segments[3] !== 'SKILL.md' ||
        !SKILL_ROOTS.includes(segments.slice(0, 2).join('/'))) continue;
    const name = segments[2];
    if (!name || name === '.' || name === '..') continue;
    const group = groups.get(name);
    if (group) group.copies.push(path);
    else groups.set(name, { path, name, copies: [] });
  }
  return [...groups.values()];
}
