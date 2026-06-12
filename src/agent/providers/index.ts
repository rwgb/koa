import Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
import { ClaudeCodeProvider } from './claude_code.js';
import { QuotaFallbackProvider } from './quota_fallback.js';
import type { KoaConfig } from '../../config/index.js';

export function createProvider(config: KoaConfig): LlmProvider {
  if (config.provider === 'ollama') {
    return new OllamaProvider(config.ollamaBaseUrl ?? 'http://localhost:11434');
  }
  if (config.provider === 'claude-code') {
    return new ClaudeCodeProvider(config.claudeCodePath ?? 'claude');
  }
  // 'auto' falls through to Anthropic; loop.ts handles per-turn provider selection
  const anthropic = new AnthropicProvider(new Anthropic({ apiKey: config.apiKey }));
  if (!config.quotaFallback) return anthropic;
  // CP16: on 429/quota exhaustion, retry the turn via the ClaudeCode CLI
  return new QuotaFallbackProvider(
    anthropic,
    new ClaudeCodeProvider(config.claudeCodePath ?? 'claude'),
  );
}

export type { LlmProvider } from './types.js';
