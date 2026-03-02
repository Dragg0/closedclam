import matter from 'gray-matter';
import { createLogger } from '../utils/logger.js';

const log = createLogger('skill-parser');

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  author?: string;
  requirements?: {
    env?: string[];
    binaries?: string[];
    config?: string[];
  };
  triggers?: string[];
  alwaysActive?: boolean;
  tags?: string[];
}

export interface ParsedSkill {
  metadata: SkillMetadata;
  instructions: string;
  rawContent: string;
}

/**
 * Parse a SKILL.md file with YAML frontmatter + markdown body.
 */
export function parseSkillFile(content: string): ParsedSkill {
  const { data, content: body } = matter(content);

  const metadata: SkillMetadata = {
    name: String(data.name || 'unnamed'),
    description: String(data.description || ''),
    version: String(data.version || '1.0.0'),
    author: data.author ? String(data.author) : undefined,
    alwaysActive: Boolean(data.alwaysActive),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    triggers: Array.isArray(data.triggers) ? data.triggers.map(String) : [],
  };

  if (data.requirements && typeof data.requirements === 'object') {
    metadata.requirements = {
      env: Array.isArray(data.requirements.env) ? data.requirements.env.map(String) : undefined,
      binaries: Array.isArray(data.requirements.binaries) ? data.requirements.binaries.map(String) : undefined,
      config: Array.isArray(data.requirements.config) ? data.requirements.config.map(String) : undefined,
    };
  }

  return {
    metadata,
    instructions: body.trim(),
    rawContent: content,
  };
}
