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

  // Serializes the system prompt and the FULL conversation history into a single
  // prompt — the claude CLI is stateless across invocations, so dropping history
  // would make every turn amnesiac. params.tools cannot be forwarded: the CLI
  // only exposes its own built-in tools, not Anthropic API tool definitions.
  private buildPrompt(params: LlmCallParams): string {
    const sections: string[] = [];
    const systemText = params.system.map((b) => b.text).join('\n');
    if (systemText) sections.push(`System:\n${systemText}`);
    for (const msg of params.messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .map((b) => {
                if (b.type === 'text') return b.text;
                if (b.type === 'tool_result' && typeof b.content === 'string') {
                  return `[tool result]\n${b.content}`;
                }
                return '';
              })
              .filter(Boolean)
              .join('\n');
      if (text) sections.push(`${role}:\n${text}`);
    }
    return sections.join('\n\n');
  }

  private doRun(
    params: LlmCallParams,
    onText: (text: string) => void,
  ): Promise<Anthropic.Message> {
    return new Promise((resolve, reject) => {
      const prompt = this.buildPrompt(params);
      const args = ['-p', '--output-format', 'json'];
      if (this.skipPermissions) args.push('--dangerously-skip-permissions');

      // Strip ANTHROPIC_API_KEY so claude uses ~/.claude.json subscription auth instead
      // of the potentially-exhausted project API key from the service environment.
      const spawnEnv = { ...process.env };
      delete spawnEnv['ANTHROPIC_API_KEY'];

      const proc = spawn(this.claudePath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv,
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
