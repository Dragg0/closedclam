import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_DIR } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory-daily');

function todayFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(MEMORY_DIR, `${date}.md`);
}

export function readDailyNote(): string {
  const path = todayFile();
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}

export function appendDailyNote(text: string): void {
  const path = todayFile();
  const timestamp = new Date().toLocaleTimeString();
  const entry = `\n## ${timestamp}\n${text}\n`;

  try {
    appendFileSync(path, entry, 'utf-8');
    log.debug('Daily note appended');
  } catch (err) {
    log.error('Failed to append daily note', { error: String(err) });
  }
}

/** Get list of recent daily note files (last N days) */
export function getRecentDailyNotes(days = 30): Array<{ date: string; path: string }> {
  const files: Array<{ date: string; path: string }> = [];

  try {
    const entries = readdirSync(MEMORY_DIR);
    const datePattern = /^\d{4}-\d{2}-\d{2}\.md$/;

    for (const entry of entries) {
      if (datePattern.test(entry)) {
        files.push({
          date: entry.replace('.md', ''),
          path: join(MEMORY_DIR, entry),
        });
      }
    }

    // Sort descending by date
    files.sort((a, b) => b.date.localeCompare(a.date));

    // Limit to recent days
    return files.slice(0, days);
  } catch {
    return [];
  }
}

export function readDailyNoteByDate(date: string): string {
  const path = join(MEMORY_DIR, `${date}.md`);
  if (!existsSync(path)) return '';
  return readFileSync(path, 'utf-8');
}
