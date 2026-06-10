import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  stripCacheControl,
  toOpenAIMessages,
  fromOpenAIResponse,
  OllamaProvider,
} from '../agent/providers/ollama.js';

// ── stripCacheControl ──────────────────────────────────────────────────────────

describe('stripCacheControl', () => {
  it('removes cache_control from TextBlockParam array', () => {
    const input: Anthropic.TextBlockParam[] = [
      { type: 'text', text: 'Hello', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'World' },
    ];
    const result = stripCacheControl(input);
    expect(result).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ]);
    // Verify no cache_control key present
    for (const block of result) {
      expect(block).not.toHaveProperty('cache_control');
    }
  });

  it('returns empty array for empty input', () => {
    expect(stripCacheControl([])).toEqual([]);
  });
});

// ── toOpenAIMessages ───────────────────────────────────────────────────────────

describe('toOpenAIMessages', () => {
  it('maps a simple user string message', () => {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'Hello there' },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([{ role: 'user', content: 'Hello there' }]);
  });

  it('maps an assistant message with text blocks', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'I can help with that.' }],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toEqual([
      { role: 'assistant', content: 'I can help with that.' },
    ]);
  });

  it('maps an assistant message with a tool_use block', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Running the tool.' },
          {
            type: 'tool_use',
            id: 'tu_123',
            name: 'bash',
            input: { command: 'ls' },
          },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('assistant');
    expect(result[0]!.tool_calls).toHaveLength(1);
    expect(result[0]!.tool_calls![0]!.id).toBe('tu_123');
    expect(result[0]!.tool_calls![0]!.function.name).toBe('bash');
    expect(JSON.parse(result[0]!.tool_calls![0]!.function.arguments)).toEqual({ command: 'ls' });
  });

  it('maps user tool_result blocks to OpenAI tool role messages', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_123',
            content: 'file1.txt\nfile2.txt',
          },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]!.role).toBe('tool');
    expect(result[0]!.tool_call_id).toBe('tu_123');
    expect(result[0]!.content).toBe('file1.txt\nfile2.txt');
  });

  it('handles tool_result with array content', () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_456',
            content: [{ type: 'text', text: 'result text' }],
          },
        ],
      },
    ];
    const result = toOpenAIMessages(messages);
    expect(result[0]!.content).toBe('result text');
  });
});

// ── fromOpenAIResponse ─────────────────────────────────────────────────────────

describe('fromOpenAIResponse', () => {
  it('maps plain text response to Anthropic.Message', () => {
    const data = {
      choices: [
        {
          message: { content: 'Hello back!', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 5 },
    };
    const msg = fromOpenAIResponse(data, 'llama3.2');
    expect(msg.role).toBe('assistant');
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.model).toBe('llama3.2');
    expect(msg.content).toHaveLength(1);
    expect((msg.content[0] as Anthropic.TextBlock).text).toBe('Hello back!');
    expect(msg.usage.input_tokens).toBe(20);
    expect(msg.usage.output_tokens).toBe(5);
    expect(msg.usage.cache_creation_input_tokens).toBe(0);
    expect(msg.usage.cache_read_input_tokens).toBe(0);
  });

  it('maps tool_calls finish_reason to tool_use stop_reason', () => {
    const data = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call_abc',
                type: 'function' as const,
                function: { name: 'bash', arguments: '{"command":"ls"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 8 },
    };
    const msg = fromOpenAIResponse(data, 'llama3.2');
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content).toHaveLength(1);
    const toolBlock = msg.content[0] as Anthropic.ToolUseBlock;
    expect(toolBlock.type).toBe('tool_use');
    expect(toolBlock.id).toBe('call_abc');
    expect(toolBlock.name).toBe('bash');
    expect(toolBlock.input).toEqual({ command: 'ls' });
  });

  it('maps length finish_reason to max_tokens stop_reason', () => {
    const data = {
      choices: [
        {
          message: { content: 'cut off', tool_calls: undefined },
          finish_reason: 'length',
        },
      ],
    };
    const msg = fromOpenAIResponse(data, 'llama3.2');
    expect(msg.stop_reason).toBe('max_tokens');
  });

  it('throws when choices array is empty', () => {
    const data = { choices: [] };
    expect(() => fromOpenAIResponse(data, 'llama3.2')).toThrow('Ollama returned no choices');
  });
});

// ── OllamaProvider.create() ────────────────────────────────────────────────────

describe('OllamaProvider.create()', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the correct URL and returns a mapped Anthropic.Message', async () => {
    const responseBody = {
      choices: [
        {
          message: { content: 'Hello from Ollama', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 4 },
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => responseBody,
    });

    const provider = new OllamaProvider('http://localhost:11434');
    const result = await provider.create({
      model: 'llama3.2',
      max_tokens: 512,
      system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      messages: [{ role: 'user', content: 'Hi there' }],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
    expect(init.method).toBe('POST');

    const sentBody = JSON.parse(init.body as string) as { stream: boolean; model: string; messages: unknown[] };
    expect(sentBody.stream).toBe(false);
    expect(sentBody.model).toBe('llama3.2');
    // System + user message
    expect(sentBody.messages).toHaveLength(2);

    expect(result.role).toBe('assistant');
    expect(result.stop_reason).toBe('end_turn');
    expect((result.content[0] as Anthropic.TextBlock).text).toBe('Hello from Ollama');
  });

  it('throws on non-OK HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service unavailable',
    });

    const provider = new OllamaProvider('http://localhost:11434');
    await expect(
      provider.create({
        model: 'llama3.2',
        max_tokens: 512,
        system: [],
        messages: [{ role: 'user', content: 'test' }],
      }),
    ).rejects.toThrow('Ollama error 503');
  });

  it('strips tools with cache_control and passes as OpenAI functions', async () => {
    const responseBody = {
      choices: [
        {
          message: { content: 'ok', tool_calls: undefined },
          finish_reason: 'stop',
        },
      ],
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => responseBody,
    });

    const provider = new OllamaProvider('http://localhost:11434');
    await provider.create({
      model: 'llama3.2',
      max_tokens: 512,
      system: [],
      messages: [{ role: 'user', content: 'test' }],
      tools: [
        {
          name: 'bash',
          description: 'Run bash commands',
          input_schema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
          // cache_control is an optional field on Anthropic.Tool
          cache_control: { type: 'ephemeral' },
        } as Anthropic.Tool,
      ],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      tools: Array<{ type: string; function: { name: string; description?: string } }>;
    };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]!.type).toBe('function');
    expect(body.tools[0]!.function.name).toBe('bash');
    // cache_control must NOT be in the sent body
    expect(JSON.stringify(body)).not.toContain('cache_control');
  });
});
