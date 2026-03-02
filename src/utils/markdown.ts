/** Escape special markdown characters for Telegram MarkdownV2 */
export function escapeMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

/** Truncate text to max length with ellipsis */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/** Strip markdown formatting for plain text */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** Format a tool result block for display */
export function formatToolResult(toolName: string, result: string, maxLength = 500): string {
  const truncated = truncate(result, maxLength);
  return `**[${toolName}]**\n${truncated}`;
}

/** Parse YAML-like frontmatter from markdown string. Returns { data, content } */
export function parseFrontmatter(markdown: string): { data: Record<string, unknown>; content: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { data: {}, content: markdown };
  const yamlBlock = match[1];
  const content = match[2];
  const data: Record<string, unknown> = {};
  for (const line of yamlBlock.split('\n')) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (kv) {
      const val = kv[2].trim();
      if (val === 'true') data[kv[1]] = true;
      else if (val === 'false') data[kv[1]] = false;
      else if (/^\d+$/.test(val)) data[kv[1]] = parseInt(val, 10);
      else if (val.startsWith('[') && val.endsWith(']')) {
        data[kv[1]] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''));
      } else {
        data[kv[1]] = val.replace(/^["']|["']$/g, '');
      }
    }
  }
  return { data, content };
}
