import type { LLMProvider, LLMMessage, ContentBlock, TextBlock } from '../providers/types.js';
import { loadConfig } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('compaction');

const CHARS_PER_TOKEN = 4;
const KEEP_RECENT_MESSAGES = 6;

export class ContextCompactor {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  /** Estimate token count for a message */
  private estimateTokens(message: LLMMessage): number {
    if (typeof message.content === 'string') {
      return Math.ceil(message.content.length / CHARS_PER_TOKEN);
    }
    let total = 0;
    for (const block of message.content) {
      if (block.type === 'text') {
        total += Math.ceil(block.text.length / CHARS_PER_TOKEN);
      } else if (block.type === 'tool_use') {
        total += Math.ceil(JSON.stringify(block.input).length / CHARS_PER_TOKEN) + 50;
      } else if (block.type === 'tool_result') {
        total += Math.ceil(block.content.length / CHARS_PER_TOKEN) + 20;
      } else if (block.type === 'image') {
        total += 1000; // rough estimate for images
      }
    }
    return total;
  }

  /** Get total token count for all messages */
  private totalTokens(messages: LLMMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateTokens(msg), 0);
  }

  /** Check if compaction is needed and perform it */
  async compactIfNeeded(_sessionKey: string, messages: LLMMessage[]): Promise<LLMMessage[]> {
    const config = loadConfig();
    const maxTokens = config.agent.maxContextTokens;
    const threshold = maxTokens * config.agent.compactionThreshold;
    const currentTokens = this.totalTokens(messages);

    if (currentTokens < threshold) {
      return messages;
    }

    log.info('Compacting context', { currentTokens, threshold, messageCount: messages.length });

    if (messages.length <= KEEP_RECENT_MESSAGES) {
      log.warn('Too few messages to compact');
      return messages;
    }

    // Split into old (to summarize) and recent (to keep)
    const oldMessages = messages.slice(0, messages.length - KEEP_RECENT_MESSAGES);
    const recentMessages = messages.slice(messages.length - KEEP_RECENT_MESSAGES);

    // Generate summary of old messages
    const summary = await this.summarizeMessages(oldMessages);

    // Create the compacted message set
    const compactedMessages: LLMMessage[] = [
      {
        role: 'user',
        content: `[Previous conversation summary: ${summary}]`,
      },
      {
        role: 'assistant',
        content: 'I understand the context from our previous conversation. How can I help you now?',
      },
      ...recentMessages,
    ];

    const newTokens = this.totalTokens(compactedMessages);
    log.info('Compaction complete', {
      oldTokens: currentTokens,
      newTokens,
      removedMessages: oldMessages.length,
      keptMessages: recentMessages.length,
    });

    return compactedMessages;
  }

  /** Summarize a set of messages using the LLM */
  private async summarizeMessages(messages: LLMMessage[]): Promise<string> {
    // Build a plain text representation of the conversation
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      if (typeof msg.content === 'string') {
        lines.push(`${role}: ${msg.content}`);
      } else {
        for (const block of msg.content) {
          if (block.type === 'text') {
            lines.push(`${role}: ${block.text}`);
          } else if (block.type === 'tool_use') {
            lines.push(`Assistant used tool: ${block.name}`);
          } else if (block.type === 'tool_result') {
            lines.push(`Tool result: ${block.content.slice(0, 200)}`);
          }
        }
      }
    }

    const conversationText = lines.join('\n');

    // Truncate to prevent the summary request itself from being too large
    const maxChars = 20_000;
    const truncated = conversationText.length > maxChars
      ? conversationText.slice(0, maxChars) + '\n... (truncated)'
      : conversationText;

    try {
      const result = await this.provider.chat({
        system: 'You are a conversation summarizer. Create a concise summary capturing all key facts, decisions, user preferences, and action items from the conversation. Be thorough but brief.',
        messages: [{
          role: 'user',
          content: `Summarize this conversation:\n\n${truncated}`,
        }],
        maxTokens: 1024,
        temperature: 0,
      });

      const text = result.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');

      return text || 'Previous conversation context not available.';
    } catch (err) {
      log.error('Failed to summarize for compaction', { error: String(err) });
      // Fallback: just include the last few messages as context
      return lines.slice(-5).join('\n');
    }
  }
}
