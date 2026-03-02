import type { LLMMessage } from '../providers/types.js';
import { loadConfig } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sessions');

export interface Session {
  key: string;
  messages: LLMMessage[];
  model: string;
  createdAt: number;
  lastActiveAt: number;
  metadata: Record<string, unknown>;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Run cleanup every minute
    this.cleanupInterval = setInterval(() => this.cleanupExpired(), 60_000);
  }

  get(key: string): Session {
    let session = this.sessions.get(key);
    if (!session) {
      const config = loadConfig();
      session = {
        key,
        messages: [],
        model: config.defaultModel,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
      };
      this.sessions.set(key, session);
      log.debug('Created new session', { key });
    }
    session.lastActiveAt = Date.now();
    return session;
  }

  reset(key: string): void {
    this.sessions.delete(key);
    log.info('Session reset', { key });
  }

  setModel(key: string, model: string): void {
    const session = this.get(key);
    session.model = model;
    log.info('Model changed', { key, model });
  }

  getModel(key: string): string {
    return this.get(key).model;
  }

  addMessage(key: string, message: LLMMessage): void {
    const session = this.get(key);
    session.messages.push(message);
    session.lastActiveAt = Date.now();
  }

  getMessages(key: string): LLMMessage[] {
    return this.get(key).messages;
  }

  /** Replace all messages (used after compaction) */
  setMessages(key: string, messages: LLMMessage[]): void {
    const session = this.get(key);
    session.messages = messages;
  }

  private cleanupExpired(): void {
    const config = loadConfig();
    const timeoutMs = config.agent.sessionTimeoutMinutes * 60_000;
    const now = Date.now();

    for (const [key, session] of this.sessions) {
      if (now - session.lastActiveAt > timeoutMs) {
        this.sessions.delete(key);
        log.info('Session expired', { key });
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
