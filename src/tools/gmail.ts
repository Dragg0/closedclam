import type { gmail_v1 } from 'googleapis';
import { createLogger } from '../utils/logger.js';
import type { Tool, ToolOutput } from './types.js';

const log = createLogger('gmail-tools');

let gmailClient: gmail_v1.Gmail | null = null;

export function setGmailClient(client: gmail_v1.Gmail): void {
  gmailClient = client;
}

function ensureClient(): gmail_v1.Gmail {
  if (!gmailClient) {
    throw new Error('Gmail not configured. Set up Gmail OAuth credentials first.');
  }
  return gmailClient;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
}

function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return '';

  // Direct body data
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // Multipart: look for text/plain first, then text/html
  if (payload.parts) {
    const textPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }

    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return stripHtml(decodeBase64Url(htmlPart.body.data));
    }

    // Nested multipart (e.g., multipart/alternative inside multipart/mixed)
    for (const part of payload.parts) {
      if (part.parts) {
        const nested = extractBody(part);
        if (nested) return nested;
      }
    }
  }

  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const gmailInboxTool: Tool = {
  name: 'gmail_inbox',
  description: 'List recent emails from the Gmail inbox. Returns sender, subject, date, and a short snippet for each email.',
  inputSchema: {
    type: 'object',
    properties: {
      maxResults: {
        type: 'number',
        description: 'Maximum number of emails to return (default: 10, max: 50)',
      },
      unreadOnly: {
        type: 'boolean',
        description: 'Only show unread emails (default: false)',
      },
    },
    required: [],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      const gmail = ensureClient();
      const maxResults = Math.min((input.maxResults as number) || 10, 50);
      const query = input.unreadOnly ? 'is:unread' : undefined;

      const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: query,
        labelIds: ['INBOX'],
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) {
        return { content: 'No emails found in inbox.' };
      }

      const results: string[] = [];
      for (const msg of messages) {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers;
        const from = getHeader(headers, 'From');
        const subject = getHeader(headers, 'Subject');
        const date = getHeader(headers, 'Date');
        const snippet = detail.data.snippet || '';
        const unread = detail.data.labelIds?.includes('UNREAD') ? ' [UNREAD]' : '';

        results.push(
          `**${subject}**${unread}\n` +
          `  From: ${from}\n` +
          `  Date: ${date}\n` +
          `  ID: ${msg.id}\n` +
          `  ${snippet}`
        );
      }

      return { content: results.join('\n\n') };
    } catch (err) {
      log.error('gmail_inbox failed', { error: String(err) });
      return { content: `Gmail inbox error: ${String(err)}`, isError: true };
    }
  },
};

export const gmailSearchTool: Tool = {
  name: 'gmail_search',
  description: 'Search emails using Gmail query syntax. Supports operators like from:, to:, subject:, is:unread, has:attachment, after:, before:, label:, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search query (e.g., "from:john subject:project is:unread")',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 10, max: 50)',
      },
    },
    required: ['query'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      const gmail = ensureClient();
      const query = String(input.query);
      const maxResults = Math.min((input.maxResults as number) || 10, 50);

      const res = await gmail.users.messages.list({
        userId: 'me',
        maxResults,
        q: query,
      });

      const messages = res.data.messages || [];
      if (messages.length === 0) {
        return { content: `No emails found for query: ${query}` };
      }

      const results: string[] = [];
      for (const msg of messages) {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = detail.data.payload?.headers;
        const from = getHeader(headers, 'From');
        const subject = getHeader(headers, 'Subject');
        const date = getHeader(headers, 'Date');
        const snippet = detail.data.snippet || '';

        results.push(
          `**${subject}**\n` +
          `  From: ${from}\n` +
          `  Date: ${date}\n` +
          `  ID: ${msg.id}\n` +
          `  ${snippet}`
        );
      }

      return { content: results.join('\n\n') };
    } catch (err) {
      log.error('gmail_search failed', { error: String(err) });
      return { content: `Gmail search error: ${String(err)}`, isError: true };
    }
  },
};

export const gmailReadTool: Tool = {
  name: 'gmail_read',
  description: 'Read the full content of a specific email by its message ID. Decodes the email body and returns headers and content.',
  inputSchema: {
    type: 'object',
    properties: {
      messageId: {
        type: 'string',
        description: 'The Gmail message ID (from gmail_inbox or gmail_search results)',
      },
    },
    required: ['messageId'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      const gmail = ensureClient();
      const messageId = String(input.messageId);

      const res = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const headers = res.data.payload?.headers;
      const from = getHeader(headers, 'From');
      const to = getHeader(headers, 'To');
      const cc = getHeader(headers, 'Cc');
      const subject = getHeader(headers, 'Subject');
      const date = getHeader(headers, 'Date');

      const body = extractBody(res.data.payload);

      // List attachments
      const attachments: string[] = [];
      if (res.data.payload?.parts) {
        for (const part of res.data.payload.parts) {
          if (part.filename && part.filename.length > 0) {
            attachments.push(`${part.filename} (${part.mimeType})`);
          }
        }
      }

      let content =
        `**Subject:** ${subject}\n` +
        `**From:** ${from}\n` +
        `**To:** ${to}\n` +
        (cc ? `**Cc:** ${cc}\n` : '') +
        `**Date:** ${date}\n` +
        (attachments.length > 0 ? `**Attachments:** ${attachments.join(', ')}\n` : '') +
        `\n---\n\n${body}`;

      // Truncate very long emails
      if (content.length > 30_000) {
        content = content.slice(0, 30_000) + '\n\n... (content truncated)';
      }

      return { content };
    } catch (err) {
      log.error('gmail_read failed', { error: String(err) });
      return { content: `Gmail read error: ${String(err)}`, isError: true };
    }
  },
};

export const gmailDraftTool: Tool = {
  name: 'gmail_draft',
  description: 'Create a draft email in Gmail. The draft will appear in the Drafts folder but will NOT be sent automatically.',
  inputSchema: {
    type: 'object',
    properties: {
      to: {
        type: 'string',
        description: 'Recipient email address',
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body content (plain text)',
      },
      cc: {
        type: 'string',
        description: 'CC email addresses (comma-separated, optional)',
      },
    },
    required: ['to', 'subject', 'body'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    try {
      const gmail = ensureClient();
      const to = String(input.to);
      const subject = String(input.subject);
      const body = String(input.body);
      const cc = input.cc ? String(input.cc) : undefined;

      // Build RFC 2822 MIME message
      const lines: string[] = [
        `To: ${to}`,
        `Subject: ${subject}`,
      ];
      if (cc) {
        lines.push(`Cc: ${cc}`);
      }
      lines.push(
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        '',
        body,
      );

      const rawMessage = lines.join('\r\n');
      const encodedMessage = Buffer.from(rawMessage).toString('base64url');

      const res = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: encodedMessage,
          },
        },
      });

      return {
        content: `Draft created successfully!\n` +
          `  Draft ID: ${res.data.id}\n` +
          `  To: ${to}\n` +
          `  Subject: ${subject}` +
          (cc ? `\n  Cc: ${cc}` : ''),
      };
    } catch (err) {
      log.error('gmail_draft failed', { error: String(err) });
      return { content: `Gmail draft error: ${String(err)}`, isError: true };
    }
  },
};

export const gmailTools = [gmailInboxTool, gmailSearchTool, gmailReadTool, gmailDraftTool];
