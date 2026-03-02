import type { Tool, ToolContext, ToolOutput } from './types.js';
import type { ToolDefinition } from '../providers/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('tools');

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
    log.debug('Tool registered', { name: tool.name });
  }

  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get tool definitions in LLM-compatible format */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  /** Execute a tool by name */
  async execute(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    log.info('Executing tool', { name, input: Object.keys(input) });
    const start = Date.now();

    try {
      const result = await tool.execute(input, ctx);
      log.info('Tool completed', { name, durationMs: Date.now() - start, isError: result.isError });
      return result;
    } catch (err) {
      log.error('Tool failed', { name, error: String(err) });
      return { content: `Tool error: ${String(err)}`, isError: true };
    }
  }

  /** List all registered tool names */
  list(): string[] {
    return Array.from(this.tools.keys());
  }
}
