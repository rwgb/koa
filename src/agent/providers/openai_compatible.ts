import type Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'node:events';
import type { LlmProvider, LlmStream, LlmCallParams } from './types.js';

// ── OpenAI-compatible wire types ───────────────────────────────────────────────

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAITool {
  type: 'function';
  function: { name: string; description?: string; parameters: unknown };
}

interface OpenAIChoice {
  message: {
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: string;
}

interface OpenAIDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

// ── Message mapping helpers ────────────────────────────────────────────────────

export function stripCacheControl(
  blocks: Anthropic.TextBlockParam[],
): Array<{ type: 'text'; text: string }> {
  return blocks.map((b) => ({ type: 'text' as const, text: b.text }));
}

export function toOpenAIMessages(messages: Anthropic.MessageParam[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'user', content: msg.content });
      } else {
        // Array content — may contain tool_result blocks
        const toolResults: OpenAIMessage[] = [];
        const textParts: string[] = [];

        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            const content =
              typeof block.content === 'string'
                ? block.content
                : Array.isArray(block.content)
                  ? block.content
                      .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
                      .map((b) => b.text)
                      .join('')
                  : '';
            toolResults.push({
              role: 'tool',
              content,
              tool_call_id: block.tool_use_id,
            });
          } else if (block.type === 'text') {
            textParts.push(block.text);
          }
        }

        // Emit tool results first, then any plain text
        for (const tr of toolResults) result.push(tr);
        if (textParts.length > 0) {
          result.push({ role: 'user', content: textParts.join('\n') });
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        result.push({ role: 'assistant', content: msg.content });
      } else {
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }

        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: textParts.join('') || null,
        };
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        result.push(assistantMsg);
      }
    }
  }

  return result;
}

export function fromOpenAIResponse(data: unknown, model: string, label = 'OpenAI-compatible provider'): Anthropic.Message {
  const resp = data as OpenAIResponse;
  const choice = resp.choices[0];
  if (!choice) {
    throw new Error(`${label} returned no choices`);
  }

  const content: Anthropic.ContentBlock[] = [];

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content, citations: [] });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        parsedInput = { _raw: tc.function.arguments };
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
        caller: { type: 'direct' },
      });
    }
  }

  let stopReason: Anthropic.Message['stop_reason'] = 'end_turn';
  if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
  else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

  const usage: Anthropic.Usage = {
    input_tokens: resp.usage?.prompt_tokens ?? 0,
    output_tokens: resp.usage?.completion_tokens ?? 0,
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
  };

  return {
    id: `openai-compat-${Date.now()}`,
    type: 'message',
    role: 'assistant',
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    container: null,
    stop_details: null,
    usage,
  };
}

export function toOpenAITools(tools: Anthropic.Tool[]): OpenAITool[] {
  return tools.map((t) => {
    const fn: OpenAITool['function'] = {
      name: t.name,
      parameters: t.input_schema,
    };
    if (t.description !== undefined) fn.description = t.description;
    return { type: 'function' as const, function: fn };
  });
}

// ── OpenAICompatibleProvider ───────────────────────────────────────────────────

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(
    private baseUrl: string,
    private apiKey: string | undefined,
    protected label = 'OpenAI-compatible',
  ) {}

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private buildBody(params: LlmCallParams, stream: boolean): unknown {
    const systemContent = stripCacheControl(params.system)
      .map((b) => b.text)
      .join('\n\n');

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemContent },
      ...toOpenAIMessages(params.messages),
    ];

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.max_tokens,
      messages,
      stream,
    };

    if (params.tools && params.tools.length > 0) {
      body['tools'] = toOpenAITools(params.tools);
    }

    return body;
  }

  stream(params: LlmCallParams): LlmStream {
    const emitter = new EventEmitter();
    const messagePromise = this.doStream(params, (text) => emitter.emit('text', text));

    const result: LlmStream = {
      on(event: 'text', listener: (text: string) => void): typeof result {
        emitter.on(event, listener);
        return result;
      },
      finalMessage: () => messagePromise,
    };

    return result;
  }

  private async doStream(
    params: LlmCallParams,
    onText: (t: string) => void,
  ): Promise<Anthropic.Message> {
    const body = this.buildBody(params, true);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${this.label} error ${response.status}: ${text.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error(`${this.label} provider returned no response body`);
    }

    let accText = '';
    const accToolCalls: Map<
      number,
      { id: string; name: string; arguments: string }
    > = new Map();
    let finishReason = 'stop';
    let usage: OpenAIUsage | undefined;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const jsonStr = trimmed.slice('data: '.length);
            if (jsonStr === '[DONE]') continue;

            let chunk: {
              choices?: Array<{ delta?: OpenAIDelta; finish_reason?: string | null }>;
              usage?: OpenAIUsage;
            };
            try {
              chunk = JSON.parse(jsonStr) as typeof chunk;
            } catch {
              continue;
            }

            if (chunk.usage) usage = chunk.usage;

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            if (choice.finish_reason) finishReason = choice.finish_reason;

            const delta = choice.delta;
            if (!delta) continue;

            if (delta.content) {
              accText += delta.content;
              onText(delta.content);
            }

            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!accToolCalls.has(idx)) {
                  accToolCalls.set(idx, { id: tc.id ?? `tc-${idx}`, name: '', arguments: '' });
                }
                const entry = accToolCalls.get(idx)!;
                if (tc.function?.name) entry.name += tc.function.name;
                if (tc.function?.arguments) entry.arguments += tc.function.arguments;
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (params.tools && params.tools.length > 0 && accToolCalls.size === 0 && finishReason === 'stop') {
      process.stderr.write(
        '[koa] openai-compatible: tools were passed but model returned end_turn — model may not support tool use\n',
      );
    }

    const assembledToolCalls =
      accToolCalls.size > 0
        ? Array.from(accToolCalls.entries()).map(([, tc]) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          }))
        : undefined;
    const assembledMessage: OpenAIChoice['message'] = { content: accText || null };
    if (assembledToolCalls !== undefined) assembledMessage.tool_calls = assembledToolCalls;
    const assembledChoice: OpenAIChoice = {
      message: assembledMessage,
      finish_reason: finishReason,
    };

    return fromOpenAIResponse(
      { choices: [assembledChoice], usage } as OpenAIResponse,
      params.model,
      this.label,
    );
  }

  async create(params: LlmCallParams): Promise<Anthropic.Message> {
    const body = this.buildBody(params, false);

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`${this.label} error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as unknown;
    return fromOpenAIResponse(data, params.model, this.label);
  }
}
