import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SESSIONS_DIR } from '../gateway/config.js';
import type { LLMMessage } from '../providers/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('transcript');

export class TranscriptWriter {
  constructor() {
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  private getPath(sessionKey: string): string {
    // Sanitize key for filesystem
    const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(SESSIONS_DIR, `${safe}.jsonl`);
  }

  append(sessionKey: string, message: LLMMessage): void {
    const path = this.getPath(sessionKey);
    const entry = {
      ts: new Date().toISOString(),
      ...message,
    };
    try {
      appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      log.error('Failed to write transcript', { sessionKey, error: String(err) });
    }
  }

  /** Load previous messages from transcript file */
  load(sessionKey: string): LLMMessage[] {
    const path = this.getPath(sessionKey);
    if (!existsSync(path)) return [];

    try {
      const lines = readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean);
      return lines.map((line) => {
        const entry = JSON.parse(line) as LLMMessage & { ts: string };
        return { role: entry.role, content: entry.content };
      });
    } catch (err) {
      log.error('Failed to load transcript', { sessionKey, error: String(err) });
      return [];
    }
  }

  /** Clear a session's transcript */
  clear(sessionKey: string): void {
    const path = this.getPath(sessionKey);
    if (existsSync(path)) {
      const { unlinkSync } = require('node:fs');
      unlinkSync(path);
    }
  }
}
