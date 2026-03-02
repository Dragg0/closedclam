import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS_DIR, INSTALLED_SKILLS_DIR } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-hub');

const HUB_CACHE_FILE = join(SKILLS_DIR, 'hub-cache.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_HUB_REPO = 'closedclam/clamhub';

export interface HubSkillEntry {
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  path: string; // path within the repo
}

interface HubCache {
  updatedAt: number;
  repo: string;
  skills: HubSkillEntry[];
}

export class SkillHub {
  private cache: HubCache | null = null;
  private repos: string[];

  constructor(additionalRepos: string[] = []) {
    this.repos = [DEFAULT_HUB_REPO, ...additionalRepos];
    this.loadCache();
  }

  private loadCache(): void {
    if (!existsSync(HUB_CACHE_FILE)) return;
    try {
      this.cache = JSON.parse(readFileSync(HUB_CACHE_FILE, 'utf-8'));
    } catch {
      this.cache = null;
    }
  }

  private saveCache(): void {
    if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
    writeFileSync(HUB_CACHE_FILE, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.updatedAt < CACHE_TTL_MS;
  }

  /** Fetch the skill index from GitHub */
  async refreshIndex(): Promise<void> {
    const skills: HubSkillEntry[] = [];

    for (const repo of this.repos) {
      try {
        // Use GitHub API to list directories in the repo
        const resp = await fetch(`https://api.github.com/repos/${repo}/contents/skills`, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'ClosedClam/1.0',
          },
        });

        if (!resp.ok) {
          log.warn('Failed to fetch hub index', { repo, status: resp.status });
          continue;
        }

        const entries = (await resp.json()) as Array<{ name: string; type: string; path: string }>;

        for (const entry of entries) {
          if (entry.type !== 'dir') continue;

          // Fetch the SKILL.md from each directory
          try {
            const skillResp = await fetch(
              `https://raw.githubusercontent.com/${repo}/main/${entry.path}/SKILL.md`,
              { headers: { 'User-Agent': 'ClosedClam/1.0' } },
            );

            if (!skillResp.ok) continue;

            const content = await skillResp.text();
            // Quick parse of frontmatter for index
            const frontmatter = extractFrontmatter(content);
            const getString = (v: string | string[] | undefined, fallback: string): string =>
              typeof v === 'string' ? v : fallback;
            const getArray = (v: string | string[] | undefined): string[] =>
              Array.isArray(v) ? v : [];
            skills.push({
              name: getString(frontmatter.name, entry.name),
              description: getString(frontmatter.description, ''),
              version: getString(frontmatter.version, '1.0.0'),
              author: getString(frontmatter.author, repo.split('/')[0]),
              tags: getArray(frontmatter.tags),
              path: entry.path,
            });
          } catch {
            log.debug('Failed to fetch skill file', { repo, path: entry.path });
          }
        }
      } catch (err) {
        log.warn('Failed to fetch hub', { repo, error: String(err) });
      }
    }

    this.cache = {
      updatedAt: Date.now(),
      repo: this.repos[0],
      skills,
    };
    this.saveCache();
    log.info('Hub index refreshed', { skills: skills.length });
  }

  /** Search available skills */
  async search(query: string): Promise<HubSkillEntry[]> {
    if (!this.isCacheValid()) {
      await this.refreshIndex();
    }

    if (!this.cache) return [];

    const terms = query.toLowerCase().split(/\s+/);
    return this.cache.skills.filter((skill) => {
      const searchable = `${skill.name} ${skill.description} ${skill.tags.join(' ')}`.toLowerCase();
      return terms.some((term) => searchable.includes(term));
    });
  }

  /** Install a skill from the hub */
  async install(skillName: string): Promise<{ success: boolean; message: string }> {
    if (!this.isCacheValid()) {
      await this.refreshIndex();
    }

    const skill = this.cache?.skills.find((s) => s.name === skillName);
    if (!skill) {
      return { success: false, message: `Skill "${skillName}" not found in hub.` };
    }

    const repo = this.cache!.repo;
    const installDir = join(INSTALLED_SKILLS_DIR, skillName);

    try {
      // Fetch the SKILL.md
      const resp = await fetch(
        `https://raw.githubusercontent.com/${repo}/main/${skill.path}/SKILL.md`,
        { headers: { 'User-Agent': 'ClosedClam/1.0' } },
      );

      if (!resp.ok) {
        return { success: false, message: `Failed to download skill: ${resp.status}` };
      }

      const content = await resp.text();

      if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });
      writeFileSync(join(installDir, 'SKILL.md'), content, 'utf-8');

      log.info('Skill installed', { name: skillName, path: installDir });
      return { success: true, message: `Skill "${skillName}" installed successfully.` };
    } catch (err) {
      return { success: false, message: `Install failed: ${String(err)}` };
    }
  }

  /** Uninstall a skill */
  uninstall(skillName: string): { success: boolean; message: string } {
    const installDir = join(INSTALLED_SKILLS_DIR, skillName);
    if (!existsSync(installDir)) {
      return { success: false, message: `Skill "${skillName}" is not installed.` };
    }

    try {
      const { rmSync } = require('node:fs');
      rmSync(installDir, { recursive: true });
      return { success: true, message: `Skill "${skillName}" uninstalled.` };
    } catch (err) {
      return { success: false, message: `Uninstall failed: ${String(err)}` };
    }
  }

  /** List all skills in the hub */
  async listAvailable(): Promise<HubSkillEntry[]> {
    if (!this.isCacheValid()) {
      await this.refreshIndex();
    }
    return this.cache?.skills || [];
  }
}

/** Quick frontmatter extraction without full parser */
function extractFrontmatter(content: string): Record<string, string | string[]> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string | string[]> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      if (val.startsWith('[') && val.endsWith(']')) {
        result[kv[1]] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        result[kv[1]] = val;
      }
    }
  }
  return result;
}
