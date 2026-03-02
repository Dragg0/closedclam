import type { Api } from 'grammy';
import type { StreamingHandle } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('telegram-stream');

const EDIT_THROTTLE_MS = 1000;
const TYPING_INTERVAL_MS = 4000;
const MAX_MESSAGE_LENGTH = 4096;

export class TelegramStreamWriter implements StreamingHandle {
  private api: Api;
  private chatId: number;
  private messageId: number | null = null;
  private buffer = '';
  private lastEditTime = 0;
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private finished = false;
  private toolStatuses: string[] = [];

  constructor(api: Api, chatId: number) {
    this.api = api;
    this.chatId = chatId;
    this.startTypingLoop();
  }

  private startTypingLoop() {
    this.sendTyping();
    this.typingTimer = setInterval(() => {
      if (!this.finished) this.sendTyping();
    }, TYPING_INTERVAL_MS);
  }

  private sendTyping() {
    this.api.sendChatAction(this.chatId, 'typing').catch(() => {});
  }

  writeText(text: string): void {
    this.buffer += text;
    this.scheduleEdit();
  }

  replaceText(text: string): void {
    this.buffer = text;
    this.scheduleEdit();
  }

  writeToolStatus(toolName: string, status: 'running' | 'done' | 'error'): void {
    const icon = status === 'running' ? '⏳' : status === 'done' ? '✅' : '❌';
    const line = `${icon} ${toolName}`;

    const existing = this.toolStatuses.findIndex((s) => s.includes(toolName));
    if (existing >= 0) {
      this.toolStatuses[existing] = line;
    } else {
      this.toolStatuses.push(line);
    }
  }

  private getDisplayText(): string {
    let text = '';
    if (this.toolStatuses.length > 0) {
      text += this.toolStatuses.join('\n') + '\n\n';
    }
    text += this.buffer;
    if (!text.trim()) text = '...';
    return text.slice(0, MAX_MESSAGE_LENGTH);
  }

  private scheduleEdit() {
    if (this.editTimer) return;

    const elapsed = Date.now() - this.lastEditTime;
    const delay = Math.max(0, EDIT_THROTTLE_MS - elapsed);

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.performEdit();
    }, delay);
  }

  private async performEdit() {
    const text = this.getDisplayText();
    try {
      if (this.messageId === null) {
        const sent = await this.api.sendMessage(this.chatId, text);
        this.messageId = sent.message_id;
      } else {
        await this.api.editMessageText(this.chatId, this.messageId, text);
      }
      this.lastEditTime = Date.now();
    } catch (err: unknown) {
      const e = err as Error & { description?: string };
      // Ignore "message is not modified" errors
      if (!e.description?.includes('message is not modified')) {
        log.warn('Failed to edit message', { error: String(err) });
      }
    }
  }

  async sendImage(buffer: Buffer, mimeType: string, caption?: string): Promise<void> {
    const ext = mimeType.includes('png') ? 'png' : 'jpg';
    await this.api.sendPhoto(this.chatId, new (await import('grammy')).InputFile(buffer, `image.${ext}`), {
      caption: caption?.slice(0, 1024),
    });
  }

  async finish(): Promise<void> {
    this.finished = true;

    if (this.editTimer) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }

    // Final edit with complete text
    const text = this.getDisplayText();
    if (text.trim() && text !== '...') {
      await this.performEdit();
    }
  }
}
