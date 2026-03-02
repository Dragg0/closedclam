import { GeminiProvider } from '../providers/gemini.js';
import type { Tool, ToolContext, ToolOutput } from './types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('image-tool');

let geminiProvider: GeminiProvider | null = null;

export function setGeminiProvider(provider: GeminiProvider): void {
  geminiProvider = provider;
}

export const generateImageTool: Tool = {
  name: 'generate_image',
  description: 'Generate an image from a text prompt using AI (Gemini). The image will be sent directly in the chat. Use detailed, descriptive prompts for best results.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed description of the image to generate',
      },
    },
    required: ['prompt'],
  },

  async execute(input: Record<string, unknown>): Promise<ToolOutput> {
    if (!geminiProvider || !geminiProvider.isReady()) {
      return { content: 'Image generation not available. Google AI API key not configured.', isError: true };
    }

    const prompt = String(input.prompt);
    log.info('Generating image', { prompt: prompt.slice(0, 100) });

    try {
      const result = await geminiProvider.generateImage(prompt);
      if (!result) {
        return { content: 'Image generation produced no output.', isError: true };
      }

      return {
        content: `Image generated for: "${prompt}"`,
        image: {
          buffer: result.buffer,
          mimeType: result.mimeType,
          caption: prompt.slice(0, 200),
        },
      };
    } catch (err) {
      return { content: `Image generation failed: ${String(err)}`, isError: true };
    }
  },
};
