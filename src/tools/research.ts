import { DeepSeekProvider } from '../providers/deepseek.js';
import { loadConfig } from '../gateway/config.js';
import type { Tool, ToolContext, ToolOutput } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('research-tool');

let deepseekProvider: DeepSeekProvider | null = null;

export function setDeepSeekProvider(provider: DeepSeekProvider): void {
  deepseekProvider = provider;
}

export const deepResearchTool: Tool = {
  name: 'deep_research',
  description: 'Conduct deep research on a topic using an advanced reasoning model (DeepSeek Reasoner). Use this for complex questions that require thorough analysis. Returns detailed thinking process and answer.',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The research question or topic to analyze in depth',
      },
    },
    required: ['question'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!deepseekProvider || !deepseekProvider.isReady()) {
      return { content: 'Deep research not available. DeepSeek API key not configured.', isError: true };
    }

    const question = String(input.question);
    const config = loadConfig();
    log.info('Starting deep research', { question: question.slice(0, 100) });

    try {
      const result = await deepseekProvider.chat({
        system: 'You are a research analyst. Provide thorough, well-structured analysis with citations where possible.',
        messages: [{ role: 'user', content: question }],
        model: config.providers.deepseek.reasonerModel,
        maxTokens: 16384,
      });

      const text = result.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { type: 'text'; text: string }).text)
        .join('\n');

      return { content: text || 'No research results produced.' };
    } catch (err) {
      return { content: `Research failed: ${String(err)}`, isError: true };
    }
  },
};
