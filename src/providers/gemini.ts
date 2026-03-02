import { GoogleGenAI } from '@google/genai';
import { getApiKey } from '../auth/credentials.js';
import { loadConfig } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';
import type {
  LLMProvider, StreamOptions, LLMStreamEvent, ContentBlock, TextBlock, LLMMessage,
} from './types.js';

const log = createLogger('gemini');

export class GeminiProvider implements LLMProvider {
  name = 'gemini';
  private client: GoogleGenAI | null = null;

  constructor() {
    const apiKey = getApiKey('gemini');
    if (apiKey) {
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  isReady(): boolean {
    return this.client !== null;
  }

  /**
   * Generate an image using Gemini's image generation model.
   * Returns the image buffer and mime type.
   */
  async generateImage(prompt: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!this.client) throw new Error('Gemini API key not configured');

    const config = loadConfig();
    const model = config.providers.gemini.imageModel;

    try {
      const response = await this.client.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      });

      // Extract image from response
      if (response.candidates && response.candidates[0]) {
        const parts = response.candidates[0].content?.parts || [];
        for (const part of parts) {
          if (part.inlineData) {
            return {
              buffer: Buffer.from(part.inlineData.data!, 'base64'),
              mimeType: part.inlineData.mimeType || 'image/png',
            };
          }
        }
      }

      log.warn('No image in Gemini response');
      return null;
    } catch (err) {
      log.error('Gemini image generation failed', { error: String(err) });
      throw err;
    }
  }

  private formatMessages(messages: LLMMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{
        text: typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((b): b is TextBlock => b.type === 'text')
              .map((b) => b.text)
              .join('\n'),
      }],
    }));
  }

  async *stream(options: StreamOptions): AsyncGenerator<LLMStreamEvent> {
    if (!this.client) throw new Error('Gemini API key not configured');

    const config = loadConfig();
    const model = options.model || config.providers.gemini.model;

    try {
      const response = await this.client.models.generateContentStream({
        model,
        contents: this.formatMessages(options.messages),
        config: {
          systemInstruction: options.system,
          maxOutputTokens: options.maxTokens || 8192,
          temperature: options.temperature,
        },
      });

      yield { type: 'message_start', model };

      for await (const chunk of response) {
        const text = chunk.text;
        if (text) {
          yield { type: 'text_delta', text };
        }
      }

      yield { type: 'message_end', stopReason: 'end_turn' };
    } catch (err) {
      yield { type: 'error', error: `Gemini error: ${String(err)}` };
    }
  }

  async chat(options: StreamOptions): Promise<{ content: ContentBlock[]; stopReason: string; model: string }> {
    const content: ContentBlock[] = [];
    let textBuf = '';
    let stopReason = 'end_turn';
    let model = '';

    for await (const event of this.stream(options)) {
      switch (event.type) {
        case 'message_start': model = event.model; break;
        case 'text_delta': textBuf += event.text; break;
        case 'message_end': stopReason = event.stopReason; break;
        case 'error': throw new Error(event.error);
      }
    }

    if (textBuf) content.push({ type: 'text', text: textBuf });
    return { content, stopReason, model };
  }
}
