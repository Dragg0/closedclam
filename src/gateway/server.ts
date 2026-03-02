import express from 'express';
import { webhookCallback } from 'grammy';
import { loadConfig } from './config.js';
import { createLogger } from '../utils/logger.js';
import { AnthropicProvider } from '../providers/anthropic.js';
import { DeepSeekProvider } from '../providers/deepseek.js';
import { GeminiProvider } from '../providers/gemini.js';
import { ProviderRouter } from '../providers/router.js';
import { TelegramAdapter } from '../channels/telegram/adapter.js';
import { SessionManager } from '../sessions/manager.js';
import { TranscriptWriter } from '../sessions/transcript.js';
import { AgentRuntime } from '../agent/runtime.js';
import { ContextBuilder } from '../agent/context.js';
import { ContextCompactor } from '../agent/compaction.js';
import { ToolRegistry } from '../tools/registry.js';
import { execTool } from '../tools/exec.js';
import { filesystemTools } from '../tools/filesystem.js';
import { webTools } from '../tools/web.js';
import { generateImageTool, setGeminiProvider } from '../tools/image.js';
import { deepResearchTool, setDeepSeekProvider } from '../tools/research.js';
import { memoryTools, setMemoryManager } from '../tools/memory-tools.js';
import { skillTools, setSkillRegistry, setSkillHub } from '../tools/skill-tools.js';
import { MemoryManager } from '../memory/manager.js';
import { SkillRegistry } from '../skills/registry.js';
import { SkillHub } from '../skills/hub.js';
import { AuthProviderManager } from '../auth/providers.js';
import { handleCommand, AGENT_COMMANDS } from '../channels/telegram/commands.js';
import type { IncomingMessage, StreamingHandle } from '../channels/types.js';

const log = createLogger('gateway');

export class Gateway {
  private telegram: TelegramAdapter | null = null;
  private sessions: SessionManager;
  private transcript: TranscriptWriter;
  private runtime!: AgentRuntime;
  private anthropic: AnthropicProvider;
  private router: ProviderRouter;
  private tools: ToolRegistry;
  private memory: MemoryManager;
  private contextBuilder: ContextBuilder;
  private compactor: ContextCompactor;
  private skillRegistry: SkillRegistry;
  private skillHub: SkillHub;
  private authManager: AuthProviderManager;
  private expressApp: express.Application | null = null;

  constructor() {
    // Auth manager (handles proactive token refresh)
    this.authManager = new AuthProviderManager();

    // Providers
    this.anthropic = new AnthropicProvider();
    const deepseek = new DeepSeekProvider();
    const gemini = new GeminiProvider();

    this.router = new ProviderRouter(this.anthropic);
    this.router.addProvider(deepseek);
    this.router.addProvider(gemini);

    // Memory
    this.memory = new MemoryManager();

    // Skills
    this.skillRegistry = new SkillRegistry();
    this.skillHub = new SkillHub();

    // Sessions + transcript
    this.sessions = new SessionManager();
    this.transcript = new TranscriptWriter();

    // Context builder
    this.contextBuilder = new ContextBuilder();
    this.contextBuilder.setMemory(this.memory);
    this.contextBuilder.setSessions(this.sessions);
    this.contextBuilder.setSkillInjector(this.skillRegistry);

    // Compactor
    this.compactor = new ContextCompactor(this.anthropic);

    // Tools
    this.tools = new ToolRegistry();
    this.tools.register(execTool);
    this.tools.registerAll(filesystemTools);
    this.tools.registerAll(webTools);
    this.tools.register(generateImageTool);
    this.tools.register(deepResearchTool);
    this.tools.registerAll(memoryTools);
    this.tools.registerAll(skillTools);

    // Wire tool dependencies
    setGeminiProvider(gemini);
    setDeepSeekProvider(deepseek);
    setMemoryManager(this.memory);
    setSkillRegistry(this.skillRegistry);
    setSkillHub(this.skillHub);

    // Runtime
    this.runtime = new AgentRuntime({
      provider: this.anthropic,
      providerRouter: this.router,
      sessions: this.sessions,
      transcript: this.transcript,
      tools: this.tools,
      contextBuilder: this.contextBuilder,
      compactor: this.compactor,
    });
  }

  async start(): Promise<void> {
    const config = loadConfig();

    if (!this.anthropic.isReady()) {
      throw new Error(
        'No Anthropic credentials configured. Run the setup wizard or set ANTHROPIC_API_KEY.'
      );
    }

    log.info('Tools registered', { tools: this.tools.list() });
    log.info('Providers available', { providers: this.router.list() });
    log.info('Skills loaded', {
      total: this.skillRegistry.getAll().length,
      active: this.skillRegistry.getActiveSkills().length,
    });

    // Initialize Telegram
    this.telegram = new TelegramAdapter();
    this.telegram.onMessage(async (msg: IncomingMessage, stream: StreamingHandle) => {
      await this.handleIncoming(msg, stream);
    });

    // Webhook or polling mode
    if (config.telegram.webhookUrl) {
      await this.startWebhookMode(config.telegram.webhookUrl);
    } else {
      await this.telegram.start();
    }

    // Graceful shutdown
    const shutdown = async () => {
      log.info('Shutting down...');
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    log.info('Gateway started', {
      provider: this.anthropic.name,
      model: config.defaultModel,
      mode: config.telegram.webhookUrl ? 'webhook' : 'polling',
    });
  }

  private async startWebhookMode(webhookUrl: string): Promise<void> {
    const app = express();
    this.expressApp = app;

    const bot = this.telegram!.getBot();

    // Health endpoint
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        uptime: process.uptime(),
        auth: this.authManager.getHealth(),
      });
    });

    // Telegram webhook
    app.use(express.json());
    app.post('/webhook', webhookCallback(bot, 'express'));

    const port = new URL(webhookUrl).port || 3000;
    app.listen(port, () => {
      log.info(`Webhook server listening on port ${port}`);
    });

    // Set webhook with Telegram
    await bot.api.setWebhook(webhookUrl + '/webhook');
    log.info('Webhook set', { url: webhookUrl + '/webhook' });
  }

  private async handleIncoming(msg: IncomingMessage, stream: StreamingHandle): Promise<void> {
    // Try handling as a built-in command first
    const handled = await handleCommand({
      msg,
      stream,
      resetSession: (key) => {
        this.sessions.reset(key);
        this.transcript.clear(key);
      },
      setModel: (key, model) => this.sessions.setModel(key, model),
      getModel: (key) => this.sessions.getModel(key),
      getMemory: async () => this.memory.getMemory() || 'No long-term memory stored yet.',
      searchMemory: async (query) => this.memory.search(query),
      getSessionMessageCount: (key) => this.sessions.getMessages(key).length,
      getProviderList: () => this.router.list(),
    });

    if (handled) return;

    // Agent commands (rewrite the message text for LLM)
    if (msg.command && AGENT_COMMANDS.has(msg.command)) {
      msg.text = `/${msg.command} ${msg.commandArgs || ''}`.trim();
    }

    // Restore session from transcript if empty
    const session = this.sessions.get(msg.sessionKey);
    if (session.messages.length === 0) {
      const history = this.transcript.load(msg.sessionKey);
      if (history.length > 0) {
        this.sessions.setMessages(msg.sessionKey, history);
        log.info('Session restored from transcript', { key: msg.sessionKey, messages: history.length });
      }
    }

    // Forward to agent runtime
    try {
      await this.runtime.handleMessage(msg, stream);
    } catch (err) {
      log.error('Unhandled runtime error', { error: String(err), sessionKey: msg.sessionKey });
      stream.replaceText('Something went wrong. Please try again or use /reset to start fresh.');
      await stream.finish();
    }
  }

  async stop(): Promise<void> {
    this.authManager.stop();
    await this.telegram?.stop();
    this.sessions.destroy();
    log.info('Gateway stopped');
  }

  getTools(): ToolRegistry { return this.tools; }
  getSessions(): SessionManager { return this.sessions; }
  getRouter(): ProviderRouter { return this.router; }
  getMemory(): MemoryManager { return this.memory; }
  getSkillRegistry(): SkillRegistry { return this.skillRegistry; }
  getContextBuilder(): ContextBuilder { return this.contextBuilder; }
  getAuthManager(): AuthProviderManager { return this.authManager; }
}
