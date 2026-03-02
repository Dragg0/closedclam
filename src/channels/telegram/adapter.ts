import { Bot, type Context } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { loadConfig } from '../../gateway/config.js';
import { createLogger } from '../../utils/logger.js';
import type { ChannelAdapter, IncomingMessage, StreamingHandle } from '../types.js';
import { TelegramStreamWriter } from './streaming.js';

const log = createLogger('telegram');

export class TelegramAdapter implements ChannelAdapter {
  name = 'telegram';
  private bot: Bot;
  private handler: ((msg: IncomingMessage, stream: StreamingHandle) => Promise<void>) | null = null;
  private allowedUsers: Set<number>;

  constructor() {
    const config = loadConfig();
    this.bot = new Bot(config.telegram.botToken);
    this.allowedUsers = new Set(config.telegram.allowedUsers);

    // Auto-retry on rate limits
    this.bot.api.config.use(autoRetry());

    this.setupMiddleware();
  }

  private setupMiddleware() {
    // Access control
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (!userId) return;

      // If no allowed users configured, allow all (first-run convenience)
      if (this.allowedUsers.size > 0 && !this.allowedUsers.has(userId)) {
        log.warn('Unauthorized access attempt', { userId, username: ctx.from?.username });
        await ctx.reply('Unauthorized. Your user ID is: ' + userId);
        return;
      }

      await next();
    });

    // Handle text messages
    this.bot.on('message:text', async (ctx) => {
      if (!this.handler) return;

      const msg = this.normalizeMessage(ctx);
      const stream = new TelegramStreamWriter(this.bot.api, ctx.chat.id);

      try {
        await this.handler(msg, stream);
      } catch (err) {
        log.error('Error handling message', { error: String(err) });
        stream.replaceText('An error occurred. Please try again.');
        await stream.finish();
      }
    });

    // Handle photos with captions
    this.bot.on('message:photo', async (ctx) => {
      if (!this.handler) return;

      const msg = this.normalizeMessage(ctx);

      // Download the highest resolution photo
      if (ctx.message.photo && ctx.message.photo.length > 0) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        try {
          const file = await ctx.api.getFile(photo.file_id);
          if (file.file_path) {
            const url = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
            const resp = await fetch(url);
            const buffer = Buffer.from(await resp.arrayBuffer());
            msg.images = [{
              data: buffer.toString('base64'),
              mimeType: 'image/jpeg',
            }];
          }
        } catch (err) {
          log.warn('Failed to download photo', { error: String(err) });
        }
      }

      const stream = new TelegramStreamWriter(this.bot.api, ctx.chat.id);
      try {
        await this.handler(msg, stream);
      } catch (err) {
        log.error('Error handling photo message', { error: String(err) });
        stream.replaceText('An error occurred. Please try again.');
        await stream.finish();
      }
    });

    this.bot.catch((err) => {
      log.error('Bot error', { error: String(err.error) });
    });
  }

  private normalizeMessage(ctx: Context): IncomingMessage {
    const text = ctx.message?.text || ctx.message?.caption || '';
    const userId = ctx.from!.id;
    const userName = ctx.from!.first_name || ctx.from!.username || String(userId);

    let command: string | undefined;
    let commandArgs: string | undefined;

    // Check for bot commands
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(/\s+/);
      command = parts[0].replace(/@\w+$/, ''); // strip @botname suffix
      commandArgs = parts.slice(1).join(' ');
    }

    return {
      sessionKey: `telegram_${userId}`,
      userName,
      userId,
      text,
      channel: 'telegram',
      command,
      commandArgs,
    };
  }

  onMessage(handler: (msg: IncomingMessage, stream: StreamingHandle) => Promise<void>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    const config = loadConfig();

    if (config.telegram.webhookUrl) {
      // Webhook mode - handled externally via express
      log.info('Telegram adapter in webhook mode');
      return;
    }

    // Long polling mode
    log.info('Starting Telegram bot (long polling)...');
    this.bot.start({
      onStart: (info) => {
        log.info(`Bot started as @${info.username}`);
        console.log(`\n🐚 ClosedClam bot started as @${info.username}\n`);
      },
    });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
    log.info('Telegram bot stopped');
  }

  /** Expose bot for webhook setup */
  getBot(): Bot {
    return this.bot;
  }
}
