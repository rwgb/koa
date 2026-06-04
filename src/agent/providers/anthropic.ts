import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmStream, LlmCallParams } from './types.js';

export class AnthropicProvider implements LlmProvider {
  constructor(private client: Anthropic) {}

  stream(params: LlmCallParams): LlmStream {
    return this.client.messages.stream(params) as unknown as LlmStream;
  }

  create(params: LlmCallParams): Promise<Anthropic.Message> {
    return this.client.messages.create(params);
  }
}
