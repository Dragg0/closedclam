import type { Api } from 'grammy';
import type { StreamingHandle } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('telegram-stream');

const EDIT_THROTTLE_MS = 1500;
const TYPING_INTERVAL_MS = 4000;
const MAX_MESSAGE_LENGTH = 4096;

export class TelegramStreamWriter implements StreamingHandle {
  private api: Api;
  private chatId: number;
  private messageId: number | null = null;
  private buffer = '';
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private typingTimer: ReturnType<typeof setInterval> | null = null;
  private finished = false;
  private toolStatuses: string[] = [];
  private editing = false;
  private pendingEdit = false;

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

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.performEdit();
    }, EDIT_THROTTLE_MS);
  }

  private async performEdit() {
    // Prevent concurrent edits - if one is in flight, mark pending
    if (this.editing) {
      this.pendingEdit = true;
      return;
    }

    this.editing = true;
    const text = this.getDisplayText();

    try {
      if (this.messageId === null) {
        const sent = await this.api.sendMessage(this.chatId, text, { parse_mode: undefined });
        this.messageId = sent.message_id;
      } else {
        await this.api.editMessageText(this.chatId, this.messageId, text, { parse_mode: undefined });
      }
    } catch (err: unknown) {
      const e = err as Error & { description?: string };
      if (!e.description?.includes('message is not modified')) {
        log.warn('Failed to edit message', { error: String(err) });
      }
    }

    this.editing = false;

    // If new content arrived while we were editing, do another edit
    if (this.pendingEdit) {
      this.pendingEdit = false;
      this.scheduleEdit();
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

    // Wait for any in-flight edit to complete
    while (this.editing) {
      await new Promise((r) => setTimeout(r, 100));
    }

    // Final edit with Markdown parsing
    const text = this.getDisplayText();
    if (text.trim() && text !== '...' && this.messageId !== null) {
      try {
        await this.api.editMessageText(this.chatId, this.messageId, text, { parse_mode: 'Markdown' });
      } catch {
        // If Markdown parse fails (malformed), send as plain text
        try {
          await this.api.editMessageText(this.chatId, this.messageId, text);
        } catch {
          // ignore
        }
      }
    } else if (text.trim() && text !== '...') {
      await this.performEdit();
    }
  }
}
