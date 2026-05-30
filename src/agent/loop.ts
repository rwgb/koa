import Anthropic from '@anthropic-ai/sdk';
import type { AgentState, TurnResult, ToolUse, ToolInput } from '../types/index.js';
import type { ToolRegistry } from './tools/registry.js';
import type { EngramClient } from '../engram/client.js';
import type { KoaConfig } from '../config/index.js';

export interface TurnCallbacks {
  onToolCall?: (name: string, input: ToolInput) => void;
  onToolResult?: (name: string, result: string) => void;
}

const SYSTEM_BASE = `You are Koa, an expert software engineering assistant with persistent project memory.
You have access to tools for reading/writing files, running shell commands, and querying project history via Engram.
Be precise, concise, and always verify your work. Prefer editing existing files over creating new ones.`;

export class AgentLoop {
  private client: Anthropic;
  private registry: ToolRegistry;
  private engram: EngramClient;
  private config: KoaConfig;
  private state: AgentState;

  constructor(config: KoaConfig, registry: ToolRegistry, engram: EngramClient) {
    this.config = config;
    this.registry = registry;
    this.engram = engram;
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.state = {
      messages: [],
      engramContext: { hotFiles: [], masterFiles: [] },
      turnCount: 0,
    };
  }

  async initialize(): Promise<void> {
    if (this.config.engramEnabled) {
      await this.engram.sync();
      this.state.engramContext = await this.engram.getContext();
      await this.engram.startSession(this.state.engramContext.goal);
    }
  }

  private buildSystemPrompt(): string {
    const parts = [SYSTEM_BASE];
    const engramInjection = this.engram.buildSystemPromptInjection(this.state.engramContext);
    if (engramInjection) parts.push(engramInjection);
    return parts.join('\n\n');
  }

  async turn(userMessage: string, callbacks?: TurnCallbacks): Promise<TurnResult> {
    this.state.messages.push({ role: 'user', content: userMessage });
    this.state.turnCount++;

    const toolUses: ToolUse[] = [];
    let finalContent = '';
    let stopReason = 'end_turn';

    let continueLoop = true;
    while (continueLoop) {
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        system: this.buildSystemPrompt(),
        messages: this.state.messages,
        tools: this.registry.toAnthropicTools(),
      });

      stopReason = response.stop_reason ?? 'end_turn';

      const assistantContent: Anthropic.MessageParam['content'] = response.content;
      this.state.messages.push({ role: 'assistant', content: assistantContent });

      if (stopReason === 'tool_use') {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          const tool = this.registry.get(block.name);
          let result: string;

          const toolInput = block.input as Record<string, unknown>;

          if (!tool) {
            result = `Error: unknown tool "${block.name}"`;
          } else {
            callbacks?.onToolCall?.(block.name, toolInput);
            try {
              result = await tool.execute(toolInput);
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`;
            }
            callbacks?.onToolResult?.(block.name, result);
          }

          toolUses.push({ id: block.id, name: block.name, input: toolInput, result });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        }

        this.state.messages.push({ role: 'user', content: toolResults });
      } else {
        continueLoop = false;
        finalContent = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
      }
    }

    return { content: finalContent, toolUses, stopReason };
  }

  async finalize(): Promise<void> {
    if (!this.config.engramEnabled || this.state.turnCount === 0) return;

    const summary = `Session with ${this.state.turnCount} turns. Last message: ${
      this.state.messages[this.state.messages.length - 1]?.role ?? 'unknown'
    }`;
    await this.engram.rememberSession(summary);
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }
}
