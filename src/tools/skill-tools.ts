import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SkillRegistry } from '../skills/registry.js';
import type { SkillHub } from '../skills/hub.js';
import { loadConfig } from '../gateway/config.js';
import type { Tool, ToolContext, ToolOutput } from './types.js';

let skillRegistry: SkillRegistry | null = null;
let skillHub: SkillHub | null = null;

export function setSkillRegistry(registry: SkillRegistry): void {
  skillRegistry = registry;
}

export function setSkillHub(hub: SkillHub): void {
  skillHub = hub;
}

export const searchSkillsTool: Tool = {
  name: 'search_skills',
  description: 'Search the skill hub for available skills to install. Use this when you need a new capability.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (e.g., "docker", "git", "python")' },
    },
    required: ['query'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!skillHub) return { content: 'Skill hub not initialized.', isError: true };

    const query = String(input.query);
    const results = await skillHub.search(query);

    if (results.length === 0) {
      return { content: `No skills found for "${query}".` };
    }

    const formatted = results
      .map((s) => `- **${s.name}** (v${s.version}) - ${s.description}\n  Tags: ${s.tags.join(', ') || 'none'}`)
      .join('\n');

    return { content: `Found ${results.length} skill(s):\n\n${formatted}` };
  },
};

export const installSkillTool: Tool = {
  name: 'install_skill',
  description: 'Install a skill from the hub. After installation, the skill\'s instructions will be available in your next response.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Name of the skill to install' },
    },
    required: ['name'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!skillHub || !skillRegistry) {
      return { content: 'Skill system not initialized.', isError: true };
    }

    const name = String(input.name);
    const result = await skillHub.install(name);

    if (result.success) {
      skillRegistry.refresh(); // Reload skills from disk
    }

    return { content: result.message, isError: !result.success };
  },
};

export const listSkillsTool: Tool = {
  name: 'list_skills',
  description: 'List all installed and active skills.',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  async execute(): Promise<ToolOutput> {
    if (!skillRegistry) return { content: 'Skill system not initialized.', isError: true };

    const skills = skillRegistry.listSkills();
    if (skills.length === 0) {
      return { content: 'No skills installed.' };
    }

    const formatted = skills
      .map((s) => {
        const status = s.active ? '✅' : '❌';
        return `${status} **${s.name}** (${s.source}) - ${s.description}`;
      })
      .join('\n');

    return { content: `Skills:\n\n${formatted}` };
  },
};

export const createSkillTool: Tool = {
  name: 'create_skill',
  description: 'Create a new custom skill by writing a SKILL.md file. Use this to teach yourself new workflows or specialized knowledge that persists across sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill name (kebab-case, e.g., "deploy-workflow")' },
      description: { type: 'string', description: 'Brief description of what the skill does' },
      instructions: { type: 'string', description: 'Detailed instructions in markdown format' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      alwaysActive: {
        type: 'boolean',
        description: 'Whether this skill should always be active (default: true)',
      },
    },
    required: ['name', 'description', 'instructions'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!skillRegistry) return { content: 'Skill system not initialized.', isError: true };

    const name = String(input.name).replace(/[^a-z0-9-]/g, '-');
    const description = String(input.description);
    const instructions = String(input.instructions);
    const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
    const alwaysActive = input.alwaysActive !== false;

    const config = loadConfig();
    const skillDir = join(config.workspace, 'skills', name);

    const content = `---
name: ${name}
description: "${description}"
version: "1.0.0"
author: "closedclam-agent"
tags: [${tags.map((t) => `"${t}"`).join(', ')}]
alwaysActive: ${alwaysActive}
---

${instructions}
`;

    try {
      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), content, 'utf-8');
      skillRegistry.refresh();
      return { content: `Skill "${name}" created and activated.` };
    } catch (err) {
      return { content: `Failed to create skill: ${String(err)}`, isError: true };
    }
  },
};

export const skillTools = [searchSkillsTool, installSkillTool, listSkillsTool, createSkillTool];
