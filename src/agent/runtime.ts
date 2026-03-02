import type { LLMProvider, LLMMessage, ContentBlock, ToolUseBlock, TextBlock, LLMStreamEvent, ToolDefinition } from '../providers/types.js';
import type { IncomingMessage, StreamingHandle } from '../channels/types.js';
import type { SessionManager } from '../sessions/manager.js';
import type { TranscriptWriter } from '../sessions/transcript.js';
import type { ToolRegistry } from '../tools/registry.js';
import { createLogger } from '../utils/logger.js';
import { loadConfig } from '../gateway/config.js';

const log = createLogger('runtime');

export interface RuntimeDeps {
  provider: LLMProvider;
  providerRouter?: { getProvider(model: string): LLMProvider };
  sessions: SessionManager;
  transcript?: TranscriptWriter;
  tools?: ToolRegistry;
  contextBuilder?: { buildSystemPrompt(sessionKey: string): Promise<string> };
  compactor?: { compactIfNeeded(sessionKey: string, messages: LLMMessage[]): Promise<LLMMessage[]> };
}

const BASE_SYSTEM_PROMPT = `You are ClosedClam, a personal AI assistant. You are helpful, direct, and capable.

You have access to tools that let you take actions. Use them when appropriate to help the user.

When using tools, think step-by-step about what information you need and which tool to use.
Be concise in your responses unless the user asks for detail.`;

export class AgentRuntime {
  private deps: RuntimeDeps;

  constructor(deps: RuntimeDeps) {
    this.deps = deps;
  }

  async handleMessage(msg: IncomingMessage, stream: StreamingHandle): Promise<void> {
    const { sessions, transcript } = this.deps;
    const config = loadConfig();
    const session = sessions.get(msg.sessionKey);

    // Build user message
    const userContent: ContentBlock[] = [];
    if (msg.images && msg.images.length > 0) {
      for (const img of msg.images) {
        userContent.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mimeType, data: img.data },
        });
      }
    }
    userContent.push({ type: 'text', text: msg.text });

    const userMessage: LLMMessage = {
      role: 'user',
      content: userContent.length === 1 ? msg.text : userContent,
    };

    sessions.addMessage(msg.sessionKey, userMessage);
    transcript?.append(msg.sessionKey, userMessage);

    // Run the agentic loop
    await this.agentLoop(msg.sessionKey, stream);
  }

  private async agentLoop(sessionKey: string, stream: StreamingHandle): Promise<void> {
    const { sessions, transcript, tools } = this.deps;
    const config = loadConfig();
    const maxIterations = config.agent.maxToolIterations;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      let messages = sessions.getMessages(sessionKey);

      // Compact if needed
      if (this.deps.compactor) {
        messages = await this.deps.compactor.compactIfNeeded(sessionKey, messages);
        sessions.setMessages(sessionKey, messages);
      }

      // Build system prompt
      let systemPrompt = BASE_SYSTEM_PROMPT;
      if (this.deps.contextBuilder) {
        systemPrompt = await this.deps.contextBuilder.buildSystemPrompt(sessionKey);
      }

      // Get tool definitions if available
      const toolDefs: ToolDefinition[] = tools ? tools.getDefinitions() : [];

      // Get the right provider for this session
      const session = sessions.get(sessionKey);
      const provider = this.deps.providerRouter
        ? this.deps.providerRouter.getProvider(session.model)
        : this.deps.provider;

      // Stream the response
      const assistantBlocks: ContentBlock[] = [];
      let textBuffer = '';
      let stopReason = 'end_turn';
      const pendingToolUses: ToolUseBlock[] = [];

      try {
        for await (const event of provider.stream({
          system: systemPrompt,
          messages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          model: session.model,
        })) {
          switch (event.type) {
            case 'text_delta':
              textBuffer += event.text;
              stream.writeText(event.text);
              break;

            case 'tool_use_start':
              // Flush any text buffer as a text block
              if (textBuffer) {
                assistantBlocks.push({ type: 'text', text: textBuffer });
                textBuffer = '';
              }
              stream.writeToolStatus(event.name, 'running');
              break;

            case 'tool_use_end':
              pendingToolUses.push({
                type: 'tool_use',
                id: event.id,
                name: event.name,
                input: event.input,
              });
              assistantBlocks.push({
                type: 'tool_use',
                id: event.id,
                name: event.name,
                input: event.input,
              });
              break;

            case 'message_end':
              stopReason = event.stopReason;
              break;

            case 'error':
              stream.writeText(`\n\nError: ${event.error}`);
              await stream.finish();
              return;
          }
        }
      } catch (err) {
        log.error('Stream error', { error: String(err) });
        stream.writeText(`\n\nError: ${String(err)}`);
        await stream.finish();
        return;
      }

      // Flush remaining text
      if (textBuffer) {
        assistantBlocks.push({ type: 'text', text: textBuffer });
      }

      // Save assistant message
      const assistantMessage: LLMMessage = {
        role: 'assistant',
        content: assistantBlocks,
      };
      sessions.addMessage(sessionKey, assistantMessage);
      transcript?.append(sessionKey, assistantMessage);

      // If no tool calls, we're done
      if (pendingToolUses.length === 0 || stopReason !== 'tool_use') {
        await stream.finish();
        return;
      }

      // Execute tool calls
      if (!tools) {
        log.warn('Tool use requested but no tools registered');
        await stream.finish();
        return;
      }

      const toolResults: ContentBlock[] = [];
      for (const toolUse of pendingToolUses) {
        try {
          const result = await tools.execute(toolUse.name, toolUse.input, {
            sessionKey,
            workspace: loadConfig().workspace,
          });
          stream.writeToolStatus(toolUse.name, 'done');

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: typeof result.content === 'string' ? result.content : JSON.stringify(result.content),
            is_error: result.isError,
          });

          // If tool returns an image, send it
          if (result.image) {
            await stream.sendImage(result.image.buffer, result.image.mimeType, result.image.caption);
          }
        } catch (err) {
          log.error('Tool execution error', { tool: toolUse.name, error: String(err) });
          stream.writeToolStatus(toolUse.name, 'error');

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error: ${String(err)}`,
            is_error: true,
          });
        }
      }

      // Add tool results as a user message
      const toolResultMessage: LLMMessage = {
        role: 'user',
        content: toolResults,
      };
      sessions.addMessage(sessionKey, toolResultMessage);
      transcript?.append(sessionKey, toolResultMessage);

      // Continue the loop (LLM will process tool results)
      log.debug('Tool loop iteration', { iteration, tools: pendingToolUses.map((t) => t.name) });
    }

    // Max iterations reached
    stream.writeText('\n\n[Max tool iterations reached]');
    await stream.finish();
  }
}
