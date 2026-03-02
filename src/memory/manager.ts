import { readMemory, writeMemory, appendMemory } from './long-term.js';
import { readDailyNote, appendDailyNote } from './daily.js';
import { searchMemory, formatSearchResults } from './search.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('memory');

export class MemoryManager {
  /** Get the full context block for system prompt injection */
  getContextBlock(): string {
    const memory = readMemory();
    const daily = readDailyNote();

    let block = '';

    if (memory) {
      block += `<long_term_memory>\n${memory}\n</long_term_memory>\n\n`;
    }

    if (daily) {
      const today = new Date().toISOString().slice(0, 10);
      block += `<daily_notes date="${today}">\n${daily}\n</daily_notes>\n\n`;
    }

    return block;
  }

  /** Read long-term memory */
  getMemory(): string {
    return readMemory();
  }

  /** Write/replace long-term memory */
  setMemory(content: string): void {
    writeMemory(content);
  }

  /** Append to long-term memory */
  addToMemory(text: string): void {
    appendMemory(text);
  }

  /** Append to today's daily note */
  addDailyNote(text: string): void {
    appendDailyNote(text);
  }

  /** Search across all memory */
  search(query: string): string {
    const results = searchMemory(query);
    return formatSearchResults(results);
  }
}
