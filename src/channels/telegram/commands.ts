import type { IncomingMessage, StreamingHandle } from '../types.js';

export interface CommandContext {
  msg: IncomingMessage;
  stream: StreamingHandle;
  resetSession: (sessionKey: string) => void;
  setModel: (sessionKey: string, model: string) => void;
  getModel: (sessionKey: string) => string;
  getMemory: () => Promise<string>;
  searchMemory: (query: string) => Promise<string>;
}

type CommandHandler = (ctx: CommandContext) => Promise<boolean>;

const commands: Record<string, CommandHandler> = {
  start: async (ctx) => {
    ctx.stream.replaceText(
      `Welcome to ClosedClam! 🐚\n\n` +
      `I'm your personal AI agent. I can:\n` +
      `• Chat and answer questions\n` +
      `• Execute commands and manage files\n` +
      `• Search the web\n` +
      `• Generate images\n` +
      `• Do deep research\n` +
      `• Learn new skills\n\n` +
      `Commands:\n` +
      `/reset - Clear conversation\n` +
      `/model <name> - Switch model\n` +
      `/memory show|search <query> - Memory management\n` +
      `/imagine <prompt> - Generate image\n` +
      `/research <question> - Deep research\n` +
      `/skills list|search|install - Manage skills\n` +
      `/help - Show this message`
    );
    await ctx.stream.finish();
    return true;
  },

  help: async (ctx) => {
    return commands.start(ctx);
  },

  reset: async (ctx) => {
    ctx.resetSession(ctx.msg.sessionKey);
    ctx.stream.replaceText('Session cleared. Starting fresh!');
    await ctx.stream.finish();
    return true;
  },

  model: async (ctx) => {
    const modelName = ctx.msg.commandArgs?.trim();
    if (!modelName) {
      const current = ctx.getModel(ctx.msg.sessionKey);
      ctx.stream.replaceText(
        `Current model: ${current}\n\n` +
        `Available models:\n` +
        `• claude-sonnet-4-20250514\n` +
        `• claude-opus-4-20250514\n` +
        `• claude-haiku-3-5-20241022\n` +
        `• deepseek-chat\n` +
        `• deepseek-reasoner`
      );
      await ctx.stream.finish();
      return true;
    }
    ctx.setModel(ctx.msg.sessionKey, modelName);
    ctx.stream.replaceText(`Model switched to: ${modelName}`);
    await ctx.stream.finish();
    return true;
  },

  memory: async (ctx) => {
    const args = ctx.msg.commandArgs?.trim() || '';
    const [action, ...rest] = args.split(' ');

    if (action === 'show') {
      const memory = await ctx.getMemory();
      ctx.stream.replaceText(memory || 'No long-term memory stored yet.');
      await ctx.stream.finish();
      return true;
    }

    if (action === 'search') {
      const query = rest.join(' ');
      if (!query) {
        ctx.stream.replaceText('Usage: /memory search <query>');
        await ctx.stream.finish();
        return true;
      }
      const results = await ctx.searchMemory(query);
      ctx.stream.replaceText(results || 'No results found.');
      await ctx.stream.finish();
      return true;
    }

    ctx.stream.replaceText('Usage: /memory show | /memory search <query>');
    await ctx.stream.finish();
    return true;
  },
};

/**
 * Try to handle the message as a command. Returns true if handled.
 */
export async function handleCommand(ctx: CommandContext): Promise<boolean> {
  const cmd = ctx.msg.command;
  if (!cmd) return false;

  const handler = commands[cmd];
  if (!handler) return false;

  return handler(ctx);
}

// Commands that should be passed through to the agent (not handled here)
export const AGENT_COMMANDS = new Set(['imagine', 'research', 'skills']);
