import type { IncomingMessage, StreamingHandle } from '../types.js';

export interface CommandContext {
  msg: IncomingMessage;
  stream: StreamingHandle;
  resetSession: (sessionKey: string) => void;
  setModel: (sessionKey: string, model: string) => void;
  getModel: (sessionKey: string) => string;
  getMemory: () => Promise<string>;
  searchMemory: (query: string) => Promise<string>;
  getSessionMessageCount: (sessionKey: string) => number;
  getProviderList: () => string[];
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
      `Use / to see available commands.`
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

  status: async (ctx) => {
    const model = ctx.getModel(ctx.msg.sessionKey);
    const msgCount = ctx.getSessionMessageCount(ctx.msg.sessionKey);
    const providers = ctx.getProviderList();
    const uptime = Math.floor(process.uptime());
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);

    ctx.stream.replaceText(
      `🐚 ClosedClam Status\n\n` +
      `Model: ${model}\n` +
      `Messages this session: ${msgCount}\n` +
      `Providers online: ${providers.join(', ')}\n` +
      `Uptime: ${hours}h ${mins}m\n` +
      `Memory: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
    );
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
        `• claude-haiku-4-5-20251001 (fast, cheap)\n` +
        `• claude-sonnet-4-20250514 (balanced)\n` +
        `• claude-opus-4-20250514 (smartest)\n` +
        `• deepseek-chat (cheap alternative)\n` +
        `• deepseek-reasoner (deep thinking)`
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

/** Telegram bot command menu definitions */
export const BOT_COMMANDS = [
  { command: 'status', description: 'Show current model, uptime, and stats' },
  { command: 'model', description: 'Switch model or show current' },
  { command: 'reset', description: 'Clear conversation history' },
  { command: 'memory', description: 'Show or search memories' },
  { command: 'imagine', description: 'Generate an image' },
  { command: 'research', description: 'Deep research a topic' },
  { command: 'skills', description: 'List, search, or install skills' },
  { command: 'help', description: 'Show help message' },
];
