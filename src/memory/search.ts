import { readMemory } from './long-term.js';
import { getRecentDailyNotes, readDailyNoteByDate } from './daily.js';
import { createLogger } from '../utils/logger.js';
import { readFileSync } from 'node:fs';

const log = createLogger('memory-search');

export interface SearchResult {
  source: string;
  date?: string;
  snippet: string;
  score: number;
}

/**
 * Full-text search across MEMORY.md and recent daily notes.
 * Simple keyword matching with basic relevance scoring.
 */
export function searchMemory(query: string, maxResults = 10): SearchResult[] {
  const results: SearchResult[] = [];
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return [];

  // Search MEMORY.md
  const memory = readMemory();
  if (memory) {
    const memoryResults = searchContent(memory, terms, 'MEMORY.md');
    results.push(...memoryResults);
  }

  // Search daily notes
  const dailyNotes = getRecentDailyNotes(30);
  for (const note of dailyNotes) {
    try {
      const content = readFileSync(note.path, 'utf-8');
      const noteResults = searchContent(content, terms, `daily/${note.date}`, note.date);
      results.push(...noteResults);
    } catch {
      // Skip unreadable files
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}

function searchContent(content: string, terms: string[], source: string, date?: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lines = content.split('\n');
  const contentLower = content.toLowerCase();

  // Check if any term matches at all
  const hasAnyMatch = terms.some((t) => contentLower.includes(t));
  if (!hasAnyMatch) return [];

  // Score sections/paragraphs
  const sections = content.split(/\n(?=##?\s)/).filter(Boolean);
  if (sections.length === 0) {
    sections.push(content);
  }

  for (const section of sections) {
    const sectionLower = section.toLowerCase();
    let score = 0;

    for (const term of terms) {
      const count = (sectionLower.match(new RegExp(escapeRegex(term), 'g')) || []).length;
      score += count;
    }

    if (score > 0) {
      // Extract a snippet (first 200 chars of the matching section)
      const snippet = section.trim().slice(0, 200);
      results.push({ source, date, snippet, score });
    }
  }

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Format search results for display */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((r, i) => {
      const header = r.date ? `[${r.source}] (${r.date})` : `[${r.source}]`;
      return `${i + 1}. ${header}\n   ${r.snippet}`;
    })
    .join('\n\n');
}
