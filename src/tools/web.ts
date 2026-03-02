import { getApiKey } from '../auth/credentials.js';
import { createLogger } from '../utils/logger.js';
import type { Tool, ToolContext, ToolOutput } from './types.js';

const log = createLogger('web-tools');

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web using Brave Search API. Returns relevant search results with titles, URLs, and snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      count: { type: 'number', description: 'Number of results (default: 5, max: 20)' },
    },
    required: ['query'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    const apiKey = getApiKey('brave');
    if (!apiKey) {
      return { content: 'Brave Search API key not configured. Set BRAVE_API_KEY.', isError: true };
    }

    const query = String(input.query);
    const count = Math.min((input.count as number) || 5, 20);

    try {
      const params = new URLSearchParams({
        q: query,
        count: String(count),
      });

      const resp = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey,
        },
      });

      if (!resp.ok) {
        return { content: `Search failed: ${resp.status} ${resp.statusText}`, isError: true };
      }

      const data = (await resp.json()) as {
        web?: { results: Array<{ title: string; url: string; description: string }> };
      };

      const results = data.web?.results || [];
      if (results.length === 0) {
        return { content: 'No results found.' };
      }

      const formatted = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description}`)
        .join('\n\n');

      return { content: formatted };
    } catch (err) {
      return { content: `Search error: ${String(err)}`, isError: true };
    }
  },
};

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch a URL and return its content as cleaned text/markdown. Useful for reading web pages, APIs, or documentation.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      maxLength: { type: 'number', description: 'Max content length in characters (default: 20000)' },
    },
    required: ['url'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    const url = String(input.url);
    const maxLength = (input.maxLength as number) || 20_000;

    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'ClosedClam/1.0 (AI Agent)',
          'Accept': 'text/html,application/json,text/plain,*/*',
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!resp.ok) {
        return { content: `Fetch failed: ${resp.status} ${resp.statusText}`, isError: true };
      }

      const contentType = resp.headers.get('content-type') || '';
      let text: string;

      if (contentType.includes('application/json')) {
        const json = await resp.json();
        text = JSON.stringify(json, null, 2);
      } else {
        text = await resp.text();
        // Basic HTML to text conversion
        if (contentType.includes('text/html')) {
          text = htmlToText(text);
        }
      }

      if (text.length > maxLength) {
        text = text.slice(0, maxLength) + '\n... (content truncated)';
      }

      return { content: text };
    } catch (err) {
      return { content: `Fetch error: ${String(err)}`, isError: true };
    }
  },
};

function htmlToText(html: string): string {
  return html
    // Remove script and style tags with content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    // Convert common elements
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<pre[^>]*>(.*?)<\/pre>/gis, '```\n$1\n```')
    // Strip remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const webTools = [webSearchTool, webFetchTool];
