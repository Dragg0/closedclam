import type { LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { DeepSeekProvider } from './deepseek.js';
import { GeminiProvider } from './gemini.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('router');

// Model name -> provider name mapping
const MODEL_ROUTES: Record<string, string> = {
  // Anthropic models
  'claude-haiku-4-5-20251001': 'anthropic',
  'claude-sonnet-4-20250514': 'anthropic',
  'claude-opus-4-20250514': 'anthropic',
  // DeepSeek models
  'deepseek-chat': 'deepseek',
  'deepseek-reasoner': 'deepseek',
  // Gemini models
  'gemini-2.0-flash-exp': 'gemini',
};

export class ProviderRouter {
  private providers = new Map<string, LLMProvider>();
  private defaultProvider: LLMProvider;

  constructor(defaultProvider: LLMProvider) {
    this.defaultProvider = defaultProvider;
    this.providers.set(defaultProvider.name, defaultProvider);
  }

  addProvider(provider: LLMProvider): void {
    if (provider.isReady()) {
      this.providers.set(provider.name, provider);
      log.info('Provider registered', { name: provider.name });
    } else {
      log.warn('Provider not ready, skipping', { name: provider.name });
    }
  }

  getProvider(model: string): LLMProvider {
    const providerName = MODEL_ROUTES[model];
    if (providerName) {
      const provider = this.providers.get(providerName);
      if (provider) return provider;
      log.warn('Provider for model not available, using default', { model, providerName });
    }

    // Try to guess by model name prefix
    if (model.startsWith('claude')) {
      const p = this.providers.get('anthropic');
      if (p) return p;
    }
    if (model.startsWith('deepseek')) {
      const p = this.providers.get('deepseek');
      if (p) return p;
    }
    if (model.startsWith('gemini')) {
      const p = this.providers.get('gemini');
      if (p) return p;
    }

    return this.defaultProvider;
  }

  /** Get a specific provider by name */
  getByName(name: string): LLMProvider | undefined {
    return this.providers.get(name);
  }

  /** List available providers */
  list(): string[] {
    return Array.from(this.providers.keys());
  }
}

export function createRouter(): ProviderRouter {
  const anthropic = new AnthropicProvider();
  const router = new ProviderRouter(anthropic);

  router.addProvider(new DeepSeekProvider());
  router.addProvider(new GeminiProvider());

  return router;
}
