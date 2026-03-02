import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import type { Tool, ToolContext, ToolOutput } from './types.js';

function safePath(workspace: string, filePath: string): string {
  const resolved = resolve(workspace, filePath);
  const rel = relative(workspace, resolved);
  if (rel.startsWith('..') || resolve(resolved) !== resolved.replace(/\/$/, '')) {
    throw new Error('Path traversal not allowed');
  }
  return resolved;
}

export const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file. Path is relative to the workspace root.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace' },
      maxLines: { type: 'number', description: 'Maximum number of lines to read (default: all)' },
    },
    required: ['path'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    try {
      const filePath = safePath(ctx.workspace, String(input.path));
      if (!existsSync(filePath)) {
        return { content: `File not found: ${input.path}`, isError: true };
      }
      let content = readFileSync(filePath, 'utf-8');
      const maxLines = input.maxLines as number | undefined;
      if (maxLines) {
        const lines = content.split('\n');
        content = lines.slice(0, maxLines).join('\n');
        if (lines.length > maxLines) {
          content += `\n... (${lines.length - maxLines} more lines)`;
        }
      }
      if (content.length > 50_000) {
        content = content.slice(0, 50_000) + '\n... (file truncated)';
      }
      return { content };
    } catch (err) {
      return { content: String(err), isError: true };
    }
  },
};

export const writeFileTool: Tool = {
  name: 'write_file',
  description: 'Write content to a file. Creates the file and parent directories if they don\'t exist. Path is relative to the workspace root.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    try {
      const filePath = safePath(ctx.workspace, String(input.path));
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, String(input.content), 'utf-8');
      return { content: `File written: ${input.path}` };
    } catch (err) {
      return { content: String(err), isError: true };
    }
  },
};

export const editFileTool: Tool = {
  name: 'edit_file',
  description: 'Edit a file by replacing a specific string with new content. The old_string must be unique in the file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to workspace' },
      old_string: { type: 'string', description: 'Exact text to find and replace (must be unique in file)' },
      new_string: { type: 'string', description: 'Text to replace with' },
    },
    required: ['path', 'old_string', 'new_string'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    try {
      const filePath = safePath(ctx.workspace, String(input.path));
      if (!existsSync(filePath)) {
        return { content: `File not found: ${input.path}`, isError: true };
      }
      const content = readFileSync(filePath, 'utf-8');
      const oldStr = String(input.old_string);
      const newStr = String(input.new_string);

      const count = content.split(oldStr).length - 1;
      if (count === 0) {
        return { content: 'old_string not found in file', isError: true };
      }
      if (count > 1) {
        return { content: `old_string found ${count} times (must be unique)`, isError: true };
      }

      const updated = content.replace(oldStr, newStr);
      writeFileSync(filePath, updated, 'utf-8');
      return { content: `File edited: ${input.path}` };
    } catch (err) {
      return { content: String(err), isError: true };
    }
  },
};

export const filesystemTools = [readFileTool, writeFileTool, editFileTool];
