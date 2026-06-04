import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import type { KoaConfig } from '../../config/index.js';

export function createProvider(config: KoaConfig): LlmProvider {
  if (config.provider === 'ollama') {
    return new OllamaProvider(config.ollamaBaseUrl ?? 'http://localhost:11434');
  }
  return new AnthropicProvider(new Anthropic({ apiKey: config.apiKey }));
}

export type { LlmProvider } from './types.js';
