import type { MemoryManager } from '../memory/manager.js';
import type { Tool, ToolContext, ToolOutput } from './types.js';

let memoryManager: MemoryManager | null = null;

export function setMemoryManager(manager: MemoryManager): void {
  memoryManager = manager;
}

export const memorySearchTool: Tool = {
  name: 'memory_search',
  description: 'Search through the user\'s stored memories and daily notes. Use this to recall things the user has told you or that you\'ve noted.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to find relevant memories',
      },
    },
    required: ['query'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!memoryManager) return { content: 'Memory system not initialized.', isError: true };
    const query = String(input.query);
    const results = memoryManager.search(query);
    return { content: results };
  },
};

export const memoryWriteTool: Tool = {
  name: 'memory_write',
  description: 'Save important information to long-term memory. Use this to remember user preferences, important facts, or decisions. This persists across sessions.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The information to remember (markdown format)',
      },
      mode: {
        type: 'string',
        enum: ['append', 'replace'],
        description: 'Whether to append to or replace existing memory (default: append)',
      },
    },
    required: ['content'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!memoryManager) return { content: 'Memory system not initialized.', isError: true };

    const content = String(input.content);
    const mode = String(input.mode || 'append');

    if (mode === 'replace') {
      memoryManager.setMemory(content);
    } else {
      memoryManager.addToMemory(content);
    }

    return { content: `Memory updated (${mode}).` };
  },
};

export const memoryTools = [memorySearchTool, memoryWriteTool];
