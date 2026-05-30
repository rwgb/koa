import Anthropic from '@anthropic-ai/sdk';
import type { AgentState, TurnResult, ToolUse, ToolInput } from '../types/index.js';
import type { ToolRegistry } from './tools/registry.js';
import type { EngramClient } from '../engram/client.js';
import type { SpiderBrainClient } from '../spiderbrain/client.js';
import type { KoaConfig } from '../config/index.js';
import { selectModel } from './router.js';
import type { UsageTracker } from './usage.js';
import {
  loadLastSession,
  saveSession,
  buildSessionRecord,
  buildSessionPromptInjection,
} from '../session/store.js';
import { loadMemories, buildMemoryPromptInjection } from '../memory/store.js';
import type { MemoryEntry } from '../memory/store.js';

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
  private sb: SpiderBrainClient;
  private config: KoaConfig;
  private state: AgentState;
  private usage: UsageTracker;
  private memories: MemoryEntry[] = [];

  constructor(config: KoaConfig, registry: ToolRegistry, engram: EngramClient, usage: UsageTracker, sb: SpiderBrainClient) {
    this.config = config;
    this.registry = registry;
    this.engram = engram;
    this.sb = sb;
    this.usage = usage;
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.state = {
      messages: [],
      engramContext: { hotFiles: [], masterFiles: [] },
      turnCount: 0,
      usage: usage.getStats(),
    };
  }

  async initialize(): Promise<void> {
    if (this.config.engramEnabled) {
      await this.engram.sync();
      this.state.engramContext = await this.engram.getContext();
      await this.engram.startSession(this.state.engramContext.goal);
    }
    this.state.spiderBrainContext = await this.sb.getContext();
    this.state.lastSessionRecord = loadLastSession(this.config.projectPath);
    this.memories = loadMemories();
  }

  private buildSystemPrompt(): string {
    const parts = [SYSTEM_BASE];
    const memoryInjection = buildMemoryPromptInjection(this.memories);
    if (memoryInjection) parts.push(memoryInjection);
    if (this.state.lastSessionRecord) {
      parts.push(buildSessionPromptInjection(this.state.lastSessionRecord));
    }
    const engramInjection = this.engram.buildSystemPromptInjection(this.state.engramContext);
    if (engramInjection) parts.push(engramInjection);
    if (this.state.spiderBrainContext) {
      const sbInjection = this.sb.buildSystemPromptInjection(this.state.spiderBrainContext);
      if (sbInjection) parts.push(sbInjection);
    }
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

    const acc = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

    let continueLoop = true;
    while (continueLoop) {
      const response = await this.client.messages.create({
        model: selectedModel,
        max_tokens: this.config.maxTokens,
        system,
        messages: this.state.messages,
        tools,
      });

      acc.inputTokens += response.usage.input_tokens;
      acc.outputTokens += response.usage.output_tokens;
      acc.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
      acc.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

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

    this.usage.addTurn({ ...acc, model: selectedModel });
    this.state.usage = this.usage.getStats();

    // Record the model used for status display
    this.state.lastModel = selectedModel;
    this.state.lastTier = tier;

    // Slide the conversation window to prevent unbounded context growth
    this.maybeCompact();

    return { content: finalContent, toolUses, stopReason, model: selectedModel, tier, usage: { ...acc, model: selectedModel } };
  }

  async finalize(): Promise<void> {
    if (this.state.turnCount === 0) return;

    // Extract all user messages (role === 'user', string content only)
    const userMessages = this.state.messages
      .filter((m) => m.role === 'user' && typeof m.content === 'string')
      .map((m) => m.content as string);

    const record = buildSessionRecord(
      this.config.projectPath,
      this.state.turnCount,
      userMessages,
    );
    saveSession(record);

    if (this.config.engramEnabled) {
      await this.engram.rememberSession(
        `${record.turnCount} turns. Started: "${record.firstMessage}"`,
      );
    }
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }
}
