import { getApiKey } from '../auth/credentials.js';
import { loadConfig } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';
import type {
  LLMProvider, StreamOptions, LLMStreamEvent, ContentBlock, TextBlock, LLMMessage,
} from './types.js';

const log = createLogger('deepseek');

export class DeepSeekProvider implements LLMProvider {
  name = 'deepseek';

  isReady(): boolean {
    return !!getApiKey('deepseek');
  }

  private getBaseUrl(): string {
    return loadConfig().providers.deepseek.baseUrl;
  }

  /** Strip reasoning_content from previous assistant messages (required by DeepSeek API) */
  private cleanMessages(messages: LLMMessage[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.role,
      content: typeof msg.content === 'string'
        ? msg.content
        : msg.content
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.text)
            .join('\n'),
    }));
  }

  async *stream(options: StreamOptions): AsyncGenerator<LLMStreamEvent> {
    const apiKey = getApiKey('deepseek');
    if (!apiKey) throw new Error('DeepSeek API key not configured');

    const config = loadConfig();
    const model = options.model || config.providers.deepseek.model;
    const isReasoner = model.includes('reasoner');

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: options.system },
        ...this.cleanMessages(options.messages),
      ],
      max_tokens: options.maxTokens || 8192,
      stream: true,
    };

    if (!isReasoner && options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    const resp = await fetch(`${this.getBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      yield { type: 'error', error: `DeepSeek API error (${resp.status}): ${errBody}` };
      return;
    }

    yield { type: 'message_start', model };

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { type: 'message_end', stopReason: 'end_turn' };
          return;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices: Array<{
              delta: {
                content?: string;
                reasoning_content?: string;
              };
              finish_reason?: string;
            }>;
          };

          const choice = parsed.choices[0];
          if (!choice) continue;

          if (choice.delta.reasoning_content) {
            yield { type: 'thinking', text: choice.delta.reasoning_content };
          }
          if (choice.delta.content) {
            yield { type: 'text_delta', text: choice.delta.content };
          }
          if (choice.finish_reason) {
            yield { type: 'message_end', stopReason: choice.finish_reason === 'stop' ? 'end_turn' : choice.finish_reason };
          }
        } catch {
          // Skip unparseable SSE chunks
        }
      }
    }
  }

  async chat(options: StreamOptions): Promise<{ content: ContentBlock[]; stopReason: string; model: string }> {
    const content: ContentBlock[] = [];
    let textBuf = '';
    let thinkingBuf = '';
    let stopReason = 'end_turn';
    let model = '';

    for await (const event of this.stream(options)) {
      switch (event.type) {
        case 'message_start':
          model = event.model;
          break;
        case 'text_delta':
          textBuf += event.text;
          break;
        case 'thinking':
          thinkingBuf += event.text;
          break;
        case 'message_end':
          stopReason = event.stopReason;
          break;
        case 'error':
          throw new Error(event.error);
      }
    }

    if (thinkingBuf) {
      content.push({ type: 'text', text: `<thinking>\n${thinkingBuf}\n</thinking>\n\n${textBuf}` });
    } else if (textBuf) {
      content.push({ type: 'text', text: textBuf });
    }

    return { content, stopReason, model };
  }
}
