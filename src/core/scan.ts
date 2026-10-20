import { findSkills, type SkillFile } from './find.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** Latest commit affecting this file at the scanned revision; requested only by the web view. */
  lastUpdated?(path: string): Promise<string | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** fetch → find → group copies → parse. Nothing is stored. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths, source.repository.name);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(results.flatMap((result) => (result.skill ? [result.skill] : []))),
    warnings: [...source.warnings, ...results.flatMap((result) => result.warnings)],
  };
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warnings: string[] }> {
  const occurrences = await Promise.all([file.path, ...file.copies].map(async (path) => {
    try {
      const bytes = await source.read(path);
      return bytes ? { path, bytes } : { path, warning: `${path}: unreadable or missing; skipped` };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { path, warning: `${path}: ${reason}; skipped` };
    }
  }));
  const warnings = occurrences.flatMap((item) => item.warning ? [item.warning] : []);
  const readable = occurrences.filter((item) => item.bytes !== undefined);
  const canonical = readable[0];
  if (!canonical) return { warnings };
  const bytes = canonical.bytes!;
  const copies = readable.slice(1);
  for (const copy of copies) {
    if (copy.bytes!.length !== bytes.length || copy.bytes!.some((value, index) => value !== bytes[index])) {
      warnings.push(`${copy.path}: conflicting copy of ${canonical.path}; using canonical metadata`);
    }
  }
  const parsed = parseSkill(new TextDecoder().decode(bytes));
  if (parsed.warning) warnings.push(`${canonical.path}: ${parsed.warning}`);
  const skill: Skill = {
    id: `${source.repository.id}:${canonical.path}`,
    repository: source.repository.id,
    path: canonical.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: copies.map((copy) => copy.path),
  };
  return { skill, warnings };
}
