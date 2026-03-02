export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock
  | DocumentBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export interface DocumentBlock {
  type: 'document';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
  title?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type LLMStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; partial_json: string }
  | { type: 'tool_use_end'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'message_start'; model: string }
  | { type: 'message_end'; stopReason: string }
  | { type: 'thinking'; text: string }
  | { type: 'error'; error: string };

export interface StreamOptions {
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMProvider {
  name: string;
  /** Stream a response from the LLM, yielding events */
  stream(options: StreamOptions): AsyncGenerator<LLMStreamEvent>;
  /** Non-streaming chat (convenience) */
  chat(options: StreamOptions): Promise<{ content: ContentBlock[]; stopReason: string; model: string }>;
  /** Check if provider is ready (has valid credentials) */
  isReady(): boolean;
}
