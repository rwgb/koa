import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmStream, LlmCallParams } from './types.js';

export class AnthropicProvider implements LlmProvider {
  constructor(private client: Anthropic) {}

  stream(params: LlmCallParams): LlmStream {
    return this.client.messages.stream(params) as unknown as LlmStream;
  }

  create(params: LlmCallParams): Promise<Anthropic.Message> {
    // tier: dynamic — user-facing turns; model selected upstream by the router
    // (AgentConfig tier / smart routing), defaults to 'standard'
    return this.client.messages.create(params);
  }
}
