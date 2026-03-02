import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SKILLS_DIR } from '../gateway/config.js';
import { loadAllSkills } from './loader.js';
import { filterEligibleSkills, generateSkillPromptBlock } from './injector.js';
import type { ParsedSkill } from './parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-registry');

const REGISTRY_FILE = join(SKILLS_DIR, 'registry.json');

interface RegistryState {
  /** Explicitly enabled skills (by name) */
  enabled: string[];
  /** Explicitly disabled skills (by name) */
  disabled: string[];
}

export class SkillRegistry {
  private skills: (ParsedSkill & { source: string; path: string })[] = [];
  private state: RegistryState = { enabled: [], disabled: [] };

  constructor() {
    this.loadState();
    this.refresh();
  }

  private loadState(): void {
    if (!existsSync(REGISTRY_FILE)) return;
    try {
      this.state = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
    } catch {
      this.state = { enabled: [], disabled: [] };
    }
  }

  private saveState(): void {
    if (!existsSync(SKILLS_DIR)) mkdirSync(SKILLS_DIR, { recursive: true });
    writeFileSync(REGISTRY_FILE, JSON.stringify(this.state, null, 2), 'utf-8');
  }

  /** Reload all skills from disk */
  refresh(): void {
    this.skills = loadAllSkills();
  }

  /** Get all loaded skills */
  getAll(): ParsedSkill[] {
    return this.skills;
  }

  /** Get active skills (eligible + not disabled, or explicitly enabled) */
  getActiveSkills(): ParsedSkill[] {
    const eligible = filterEligibleSkills(this.skills);

    return eligible.filter((skill) => {
      // Always-active skills that aren't explicitly disabled
      if (skill.metadata.alwaysActive && !this.state.disabled.includes(skill.metadata.name)) {
        return true;
      }
      // Explicitly enabled skills
      if (this.state.enabled.includes(skill.metadata.name)) {
        return true;
      }
      // By default, all eligible skills are active unless disabled
      return !this.state.disabled.includes(skill.metadata.name);
    });
  }

  /** Get the system prompt injection for all active skills */
  getActiveSkillsPrompt(): string {
    const active = this.getActiveSkills();
    return generateSkillPromptBlock(active);
  }

  /** Enable a skill */
  enable(name: string): boolean {
    const skill = this.skills.find((s) => s.metadata.name === name);
    if (!skill) return false;

    this.state.enabled = [...new Set([...this.state.enabled, name])];
    this.state.disabled = this.state.disabled.filter((n) => n !== name);
    this.saveState();
    return true;
  }

  /** Disable a skill */
  disable(name: string): boolean {
    this.state.disabled = [...new Set([...this.state.disabled, name])];
    this.state.enabled = this.state.enabled.filter((n) => n !== name);
    this.saveState();
    return true;
  }

  /** Get a skill by name */
  getByName(name: string): ParsedSkill | undefined {
    return this.skills.find((s) => s.metadata.name === name);
  }

  /** List skills with their status */
  listSkills(): Array<{ name: string; description: string; active: boolean; source: string }> {
    const active = this.getActiveSkills();
    const activeNames = new Set(active.map((s) => s.metadata.name));

    return this.skills.map((s) => ({
      name: s.metadata.name,
      description: s.metadata.description,
      active: activeNames.has(s.metadata.name),
      source: s.source,
    }));
  }
}
