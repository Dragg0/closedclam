import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { ParsedSkill } from './parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-injector');

/**
 * Check if a skill's requirements are met.
 */
export function checkRequirements(skill: ParsedSkill): { met: boolean; missing: string[] } {
  const missing: string[] = [];
  const reqs = skill.metadata.requirements;

  if (!reqs) return { met: true, missing };

  // Check environment variables
  if (reqs.env) {
    for (const envVar of reqs.env) {
      if (!process.env[envVar]) {
        missing.push(`env:${envVar}`);
      }
    }
  }

  // Check binary availability
  if (reqs.binaries) {
    for (const binary of reqs.binaries) {
      try {
        execSync(`which ${binary}`, { stdio: 'pipe' });
      } catch {
        missing.push(`binary:${binary}`);
      }
    }
  }

  return { met: missing.length === 0, missing };
}

/**
 * Generate the system prompt block for active skills.
 */
export function generateSkillPromptBlock(skills: ParsedSkill[]): string {
  if (skills.length === 0) return '';

  const blocks = skills.map((skill) => {
    return `<skill name="${skill.metadata.name}" version="${skill.metadata.version}">\n${skill.instructions}\n</skill>`;
  });

  return blocks.join('\n\n');
}

/**
 * Filter skills to only those that are eligible (requirements met).
 */
export function filterEligibleSkills(skills: ParsedSkill[]): ParsedSkill[] {
  return skills.filter((skill) => {
    const { met, missing } = checkRequirements(skill);
    if (!met) {
      log.debug('Skill ineligible', { name: skill.metadata.name, missing });
    }
    return met;
  });
}
