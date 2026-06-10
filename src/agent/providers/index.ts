import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { ClaudeCodeProvider } from './claude_code.js';
import type { KoaConfig } from '../../config/index.js';

export function createProvider(config: KoaConfig): LlmProvider {
  if (config.provider === 'ollama') {
    return new OllamaProvider(config.ollamaBaseUrl ?? 'http://localhost:11434');
  }
  if (config.provider === 'claude-code') {
    return new ClaudeCodeProvider(config.claudeCodePath ?? 'claude');
  }
  // 'auto' falls through to Anthropic; loop.ts handles per-turn provider selection
  return new AnthropicProvider(new Anthropic({ apiKey: config.apiKey }));
}

export type { LlmProvider } from './types.js';
