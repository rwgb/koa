import { spawn } from 'child_process';
import { EventEmitter } from 'node:events';
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, LlmStream, LlmCallParams } from './types.js';

export class ClaudeCodeProvider implements LlmProvider {
  constructor(
    private readonly claudePath: string = 'claude',
    private readonly skipPermissions: boolean = false,
  ) {}

  stream(params: LlmCallParams): LlmStream {
    const emitter = new EventEmitter();
    const messagePromise = this.doRun(params, (text) => emitter.emit('text', text));

    const result: LlmStream = {
      on(event: 'text', listener: (text: string) => void): typeof result {
        emitter.on(event, listener);
        return result;
      },
      finalMessage: () => messagePromise,
    };
    return result;
  }

  async create(params: LlmCallParams): Promise<Anthropic.Message> {
    return this.doRun(params, () => {});
  }

  private buildPrompt(params: LlmCallParams): string {
    const lastMsg = params.messages.at(-1);
    if (!lastMsg) return '';
    if (typeof lastMsg.content === 'string') return lastMsg.content;
    return (lastMsg.content as Anthropic.ContentBlockParam[])
      .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  private doRun(
    params: LlmCallParams,
    onText: (text: string) => void,
  ): Promise<Anthropic.Message> {
    return new Promise((resolve, reject) => {
      const prompt = this.buildPrompt(params);
      const args = ['-p', '--output-format', 'json'];
      if (this.skipPermissions) args.push('--dangerously-skip-permissions');

      const proc = spawn(this.claudePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.stdin?.write(prompt);
      proc.stdin?.end();

      proc.on('error', (err) => reject(new Error(`Failed to spawn claude: ${err.message}`)));

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`));
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim()) as {
            result?: string;
            is_error?: boolean;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          if (parsed.is_error) {
            reject(new Error(`claude error: ${parsed.result ?? 'unknown error'}`));
            return;
          }
          const text = parsed.result ?? stdout.trim();
          onText(text);
          resolve(this.buildMessage(text, params.model, parsed.usage));
        } catch {
          onText(stdout.trim());
          resolve(this.buildMessage(stdout.trim(), params.model));
        }
      });
    });
  }

  private buildMessage(
    text: string,
    model: string,
    usage?: { input_tokens?: number; output_tokens?: number },
  ): Anthropic.Message {
    return {
      id: `claude-code-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text, citations: [] }],
      model,
      stop_reason: 'end_turn',
      stop_sequence: null,
      container: null,
      stop_details: null,
      usage: {
        input_tokens: usage?.input_tokens ?? 0,
        output_tokens: usage?.output_tokens ?? 0,
        cache_creation: null,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        inference_geo: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: null,
      },
    };
  }
}
