import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_DIR } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory-lt');

const MEMORY_FILE = join(MEMORY_DIR, 'MEMORY.md');
const MAX_MEMORY_SIZE = 50_000; // chars

export function readMemory(): string {
  if (!existsSync(MEMORY_FILE)) return '';
  try {
    return readFileSync(MEMORY_FILE, 'utf-8');
  } catch (err) {
    log.error('Failed to read MEMORY.md', { error: String(err) });
    return '';
  }
}

export function writeMemory(content: string): void {
  try {
    writeFileSync(MEMORY_FILE, content, 'utf-8');
    log.info('MEMORY.md updated', { length: content.length });
  } catch (err) {
    log.error('Failed to write MEMORY.md', { error: String(err) });
  }
}

export function appendMemory(text: string): void {
  try {
    const current = readMemory();
    const newContent = current ? `${current}\n\n${text}` : text;
    if (newContent.length > MAX_MEMORY_SIZE) {
      log.warn('Memory approaching size limit', { length: newContent.length });
    }
    writeFileSync(MEMORY_FILE, newContent, 'utf-8');
    log.info('MEMORY.md appended', { addedLength: text.length });
  } catch (err) {
    log.error('Failed to append to MEMORY.md', { error: String(err) });
  }
}
