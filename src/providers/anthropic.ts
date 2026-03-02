import Anthropic from '@anthropic-ai/sdk';
import { getOAuthTokens, saveOAuthTokens, getApiKey } from '../auth/credentials.js';
import { refreshAccessToken, type OAuthTokens } from '../auth/oauth.js';
import { loadConfig } from '../gateway/config.js';
import { createLogger } from '../utils/logger.js';
import type {
  LLMProvider, StreamOptions, LLMStreamEvent, ContentBlock,
  TextBlock, ToolUseBlock, LLMMessage,
} from './types.js';

const log = createLogger('anthropic');

const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic | null = null;
  private oauthTokens: OAuthTokens | null = null;
  private mode: 'oauth' | 'apikey' = 'oauth';

  constructor() {
    this.initClient();
  }

  private initClient() {
    const config = loadConfig();
    this.mode = config.providers.anthropic.authMode;

    if (this.mode === 'oauth') {
      this.oauthTokens = getOAuthTokens() ?? null;
      if (this.oauthTokens) {
        this.client = new Anthropic({
          authToken: this.oauthTokens.accessToken,
        });
        return;
      }
      log.warn('No OAuth tokens found, falling back to API key');
    }

    // API key fallback
    const apiKey = getApiKey('anthropic');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.mode = 'apikey';
    }
  }

  isReady(): boolean {
    return this.client !== null;
  }

  private async ensureValidToken(): Promise<void> {
    if (this.mode !== 'oauth' || !this.oauthTokens) return;

    const now = Date.now();
    if (now < this.oauthTokens.expiresAt - TOKEN_REFRESH_BUFFER_MS) return;

    log.info('Refreshing OAuth token...');
    try {
      this.oauthTokens = await refreshAccessToken(this.oauthTokens.refreshToken);
      saveOAuthTokens(this.oauthTokens);
      this.client = new Anthropic({
        authToken: this.oauthTokens.accessToken,
      });
      log.info('OAuth token refreshed successfully');
    } catch (err) {
      log.error('OAuth token refresh failed', { error: String(err) });
      // Try API key fallback
      const apiKey = getApiKey('anthropic');
      if (apiKey) {
        log.info('Falling back to API key');
        this.client = new Anthropic({ apiKey });
        this.mode = 'apikey';
      } else {
        throw err;
      }
    }
  }

  private getBetas(): string[] {
    return this.mode === 'oauth' ? [OAUTH_BETA_HEADER] : [];
  }

  private convertMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
    return messages.map((msg) => {
      if (typeof msg.content === 'string') {
        return { role: msg.role, content: msg.content };
      }
      const blocks: Anthropic.ContentBlockParam[] = msg.content.map((block) => {
        switch (block.type) {
          case 'text':
            return { type: 'text' as const, text: block.text };
          case 'tool_use':
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            };
          case 'tool_result':
            return {
              type: 'tool_result' as const,
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error,
            };
          case 'image':
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: block.source.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: block.source.data,
              },
            };
          default:
            return { type: 'text' as const, text: JSON.stringify(block) };
        }
      });
      return { role: msg.role, content: blocks };
    });
  }

  async *stream(options: StreamOptions): AsyncGenerator<LLMStreamEvent> {
    await this.ensureValidToken();
    if (!this.client) throw new Error('Anthropic client not initialized');

    const config = loadConfig();
    const model = options.model || config.providers.anthropic.model;
    const maxTokens = options.maxTokens || config.providers.anthropic.maxTokens;

    // System prompt prefix for OAuth mode to mimic Claude Code
    let system = options.system;
    if (this.mode === 'oauth') {
      system = `You are Claude Code, Anthropic's official CLI for Claude.\n\n${system}`;
    }

    try {
      const streamParams: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        system,
        messages: this.convertMessages(options.messages),
        tools: options.tools as Anthropic.Tool[] | undefined,
        temperature: options.temperature,
      };
      const betas = this.getBetas();
      if (betas.length > 0) {
        streamParams.betas = betas;
      }
      const stream = this.client.messages.stream(streamParams as unknown as Parameters<typeof this.client.messages.stream>[0]);

      let currentToolId = '';
      let currentToolName = '';
      let toolJsonBuf = '';

      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            yield { type: 'message_start', model: event.message.model };
            break;

          case 'content_block_start':
            if (event.content_block.type === 'tool_use') {
              currentToolId = event.content_block.id;
              currentToolName = event.content_block.name;
              toolJsonBuf = '';
              yield { type: 'tool_use_start', id: currentToolId, name: currentToolName };
            }
            break;

          case 'content_block_delta':
            if (event.delta.type === 'text_delta') {
              yield { type: 'text_delta', text: event.delta.text };
            } else if (event.delta.type === 'input_json_delta') {
              toolJsonBuf += event.delta.partial_json;
              yield { type: 'tool_use_delta', partial_json: event.delta.partial_json };
            }
            break;

          case 'content_block_stop':
            if (currentToolId) {
              let input: Record<string, unknown> = {};
              try {
                if (toolJsonBuf) input = JSON.parse(toolJsonBuf);
              } catch {
                log.warn('Failed to parse tool input JSON', { toolJsonBuf });
              }
              yield { type: 'tool_use_end', id: currentToolId, name: currentToolName, input };
              currentToolId = '';
              currentToolName = '';
              toolJsonBuf = '';
            }
            break;

          case 'message_stop':
            yield { type: 'message_end', stopReason: (stream as unknown as { currentMessage: { stop_reason: string } }).currentMessage?.stop_reason || 'end_turn' };
            break;
        }
      }
    } catch (err: unknown) {
      const error = err as Error & { status?: number };
      if (error.status === 401 && this.mode === 'oauth') {
        log.warn('Got 401, attempting token refresh...');
        this.oauthTokens!.expiresAt = 0; // force refresh
        await this.ensureValidToken();
        // Retry once
        yield* this.stream(options);
        return;
      }
      yield { type: 'error', error: String(err) };
    }
  }

  async chat(options: StreamOptions): Promise<{ content: ContentBlock[]; stopReason: string; model: string }> {
    const content: ContentBlock[] = [];
    let stopReason = 'end_turn';
    let model = '';

    for await (const event of this.stream(options)) {
      switch (event.type) {
        case 'message_start':
          model = event.model;
          break;
        case 'text_delta':
          if (content.length === 0 || content[content.length - 1].type !== 'text') {
            content.push({ type: 'text', text: '' });
          }
          (content[content.length - 1] as TextBlock).text += event.text;
          break;
        case 'tool_use_end':
          content.push({
            type: 'tool_use',
            id: event.id,
            name: event.name,
            input: event.input,
          } as ToolUseBlock);
          break;
        case 'message_end':
          stopReason = event.stopReason;
          break;
        case 'error':
          throw new Error(event.error);
      }
    }

    return { content, stopReason, model };
  }
}
