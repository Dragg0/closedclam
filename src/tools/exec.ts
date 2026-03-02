import { execSync } from 'node:child_process';
import type { Tool, ToolContext, ToolOutput } from './types.js';

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 10_000;

// Commands that are always blocked
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+[/~]/,
  /mkfs/,
  /dd\s+if=/,
  /:(){ :|:& };:/,
  />\s*\/dev\/sd/,
];

function isSafe(command: string): boolean {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) return false;
  }
  return true;
}

export const execTool: Tool = {
  name: 'exec',
  description: 'Execute a shell command and return its output. Use this for running scripts, checking system state, git operations, etc. Commands run in the workspace directory.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },
  requiresApproval: false,

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const command = String(input.command);
    const timeout = (input.timeout as number) || TIMEOUT_MS;

    if (!isSafe(command)) {
      return { content: 'Command blocked for safety reasons.', isError: true };
    }

    try {
      const output = execSync(command, {
        cwd: ctx.workspace,
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const trimmed = output.length > MAX_OUTPUT_LENGTH
        ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)'
        : output;

      return { content: trimmed || '(no output)' };
    } catch (err: unknown) {
      const e = err as Error & { stdout?: string; stderr?: string; status?: number };
      const output = (e.stdout || '') + (e.stderr || '');
      const trimmed = output.length > MAX_OUTPUT_LENGTH
        ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)'
        : output;
      return {
        content: `Exit code: ${e.status ?? 1}\n${trimmed || e.message}`,
        isError: true,
      };
    }
  },
};
