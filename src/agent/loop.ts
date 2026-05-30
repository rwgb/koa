import Anthropic from '@anthropic-ai/sdk';
import type { AgentState, TurnResult, ToolUse, ToolInput } from '../types/index.js';
import type { ToolRegistry } from './tools/registry.js';
import type { EngramClient } from '../engram/client.js';
import type { KoaConfig } from '../config/index.js';
import { selectModel } from './router.js';

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

  private maybeCompact(): void {
    // Each turn produces 1 user + 1 assistant message (at minimum), so window * 2 preserves
    // the most recent compactAfterTurns turns worth of context
    const window = this.config.compactAfterTurns * 2;
    if (this.state.messages.length > window) {
      this.state.messages = this.state.messages.slice(-window);
    }
  }

  async turn(userMessage: string, callbacks?: TurnCallbacks): Promise<TurnResult> {
    // Resolve the model for this turn, potentially stripping a @tier: prefix
    const { model: selectedModel, tier, cleanMessage } = selectModel(
      userMessage,
      this.state.messages.filter((m) => m.role === 'assistant').length,
      { model: this.config.model, smartRouting: this.config.smartRouting },
    );

    this.state.messages.push({ role: 'user', content: cleanMessage });
    this.state.turnCount++;

    const toolUses: ToolUse[] = [];
    let finalContent = '';
    let stopReason = 'end_turn';

    // Build the system prompt as a cached TextBlockParam array — biggest spend win
    const system: Array<Anthropic.TextBlockParam> = [
      {
        type: 'text' as const,
        text: this.buildSystemPrompt(),
        cache_control: { type: 'ephemeral' as const },
      },
    ];

    // Add cache_control to the last tool so the whole tool list is cached
    const tools = this.registry.toAnthropicTools();
    if (tools.length > 0) {
      tools[tools.length - 1] = {
        ...tools[tools.length - 1]!,
        cache_control: { type: 'ephemeral' as const },
      };
    }

    let continueLoop = true;
    while (continueLoop) {
      const response = await this.client.messages.create({
        model: selectedModel,
        max_tokens: this.config.maxTokens,
        system,
        messages: this.state.messages,
        tools,
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

          // Truncate oversized tool outputs to keep context manageable
          if (result.length > this.config.maxToolOutputChars) {
            result =
              result.slice(0, this.config.maxToolOutputChars) +
              `\n[truncated — ${result.length} total chars]`;
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

    // Record the model used for status display
    this.state.lastModel = selectedModel;
    this.state.lastTier = tier;

    // Slide the conversation window to prevent unbounded context growth
    this.maybeCompact();

    return { content: finalContent, toolUses, stopReason, model: selectedModel, tier };
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
