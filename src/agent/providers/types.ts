import type Anthropic from '@anthropic-ai/sdk';

// Minimal stream interface matching what loop.ts uses from Anthropic MessageStream
export interface LlmStream {
  on(event: 'text', listener: (text: string) => void): this;
  finalMessage(): Promise<Anthropic.Message>;
}

// Unified params passed to both stream() and create()
export interface LlmCallParams {
  model: string;
  max_tokens: number;
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
}

export interface LlmProvider {
  stream(params: LlmCallParams): LlmStream;
  create(params: LlmCallParams): Promise<Anthropic.Message>;
}
