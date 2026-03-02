import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, INSTALLED_SKILLS_DIR } from '../gateway/config.js';
import { parseSkillFile, type ParsedSkill } from './parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-loader');

// Bundled skills directory (relative to project root)
const BUNDLED_SKILLS_DIR = join(import.meta.dirname, '../../skills');

interface LoadedSkill extends ParsedSkill {
  source: 'workspace' | 'installed' | 'bundled';
  path: string;
}

/**
 * Discover and load SKILL.md files from all directories.
 * Precedence: workspace > user-installed > bundled
 */
export function loadAllSkills(): LoadedSkill[] {
  const config = loadConfig();
  const skills: LoadedSkill[] = [];
  const seen = new Set<string>();

  // 1. Workspace skills (highest priority)
  const workspaceSkillsDir = join(config.workspace, 'skills');
  loadFromDirectory(workspaceSkillsDir, 'workspace', skills, seen);

  // 2. User-installed skills
  loadFromDirectory(INSTALLED_SKILLS_DIR, 'installed', skills, seen);

  // 3. Bundled skills (lowest priority)
  loadFromDirectory(BUNDLED_SKILLS_DIR, 'bundled', skills, seen);

  log.info('Skills loaded', {
    total: skills.length,
    sources: {
      workspace: skills.filter((s) => s.source === 'workspace').length,
      installed: skills.filter((s) => s.source === 'installed').length,
      bundled: skills.filter((s) => s.source === 'bundled').length,
    },
  });

  return skills;
}

function loadFromDirectory(
  dir: string,
  source: LoadedSkill['source'],
  skills: LoadedSkill[],
  seen: Set<string>,
): void {
  if (!existsSync(dir)) return;

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = join(dir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      try {
        const content = readFileSync(skillFile, 'utf-8');
        const parsed = parseSkillFile(content);

        // Skip if already loaded from higher-priority source
        if (seen.has(parsed.metadata.name)) {
          log.debug('Skill shadowed by higher-priority source', { name: parsed.metadata.name, source });
          continue;
        }

        seen.add(parsed.metadata.name);
        skills.push({ ...parsed, source, path: skillFile });
      } catch (err) {
        log.warn('Failed to parse skill', { path: skillFile, error: String(err) });
      }
    }
  } catch (err) {
    log.warn('Failed to read skills directory', { dir, error: String(err) });
  }
}
