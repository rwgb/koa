import Anthropic from '@anthropic-ai/sdk';
import crypto from 'crypto';
import type { AgentState, TurnResult, ToolUse, ToolInput, ToolResultContent } from '../types/index.js';
import type { ToolRegistry } from './tools/registry.js';
import type { EngramClient } from '../engram/client.js';
import type { SpiderBrainClient } from '../spiderbrain/client.js';
import type { KoaConfig } from '../config/index.js';
import { selectModel } from './router.js';
import type { UsageTracker } from './usage.js';
import { loadMemories, buildMemoryPromptInjection } from '../memory/store.js';
import type { MemoryEntry } from '../memory/store.js';
import {
  ensureProjectMemoryDir,
  readMarkdownFile,
  writeMarkdownFile,
  appendJournalEntry,
  readRecentJournals,
} from '../project-memory/store.js';
import { sendNtfyNotification } from '../integrations/store.js';
import { projectMemoryPaths } from '../project-memory/paths.js';
import { generateProjectDoc } from '../project-memory/generators/project-doc.js';
import { generateStateDoc, generateJournalEntry } from '../project-memory/generators/state-doc.js';
import { ResponseCache } from './cache.js';

export interface TurnCallbacks {
  onToolCall?: (name: string, input: ToolInput) => void;
  onToolResult?: (name: string, result: string) => void;
  onClassifying?: () => void;
  onClassified?: (tier: string) => void;
}

const SYSTEM_BASE = `You are Koa, an expert software engineering assistant with persistent project memory.
You have access to tools for reading/writing files, running shell commands, querying project history via Engram, and analyzing image files via the analyze_image tool.
Be precise, concise, and always verify your work. Prefer editing existing files over creating new ones.`;

// Approximate per-token pricing (USD) for cost estimation in logUsage.
const PRICING: Record<string, { input: number; cacheWrite: number; cacheRead: number; output: number }> = {
  haiku: { input: 0.0000008, cacheWrite: 0.000001, cacheRead: 0.00000008, output: 0.000004 },
  sonnet: { input: 0.000003, cacheWrite: 0.00000375, cacheRead: 0.0000003, output: 0.000015 },
  opus: { input: 0.000015, cacheWrite: 0.00001875, cacheRead: 0.0000015, output: 0.000075 },
};

function pricingFor(model: string) {
  if (model.includes('haiku')) return PRICING['haiku']!;
  if (model.includes('opus')) return PRICING['opus']!;
  return PRICING['sonnet']!;
}

/**
 * Trims a message history to at most `window` entries, always starting at the
 * first plain user text message so that no orphaned tool_result blocks or
 * leading assistant messages are left — both of which cause 400 errors.
 */
export function compactMessages(
  messages: Anthropic.MessageParam[],
  window: number,
): Anthropic.MessageParam[] {
  if (messages.length <= window) return messages;
  let start = messages.length - window;
  while (start < messages.length) {
    const msg = messages[start]!;
    if (msg.role === 'user' && typeof msg.content === 'string') break;
    start++;
  }
  return messages.slice(start);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function isCodeQuery(message: string): boolean {
  const signals = ['function', 'file', 'module', 'error', 'bug', 'src/', 'import', 'class', 'type', '.ts', '.js', '.py', 'test', 'lint', 'build', 'compile'];
  const lower = message.toLowerCase();
  return signals.some((s) => lower.includes(s));
}

export function hasBacklogSignals(message: string): boolean {
  const signals = ['task', 'backlog', 'plan', 'next', 'todo', 'priority', 'should we', "what's left", 'checkpoint'];
  const lower = message.toLowerCase();
  return signals.some((s) => lower.includes(s));
}

function logUsage(
  acc: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number },
  model: string,
  context: { spiderBrain: boolean; backlog: boolean; state: boolean; handoff: boolean },
): void {
  const total = acc.inputTokens + acc.cacheReadTokens;
  const cachePct = total > 0 ? Math.round((acc.cacheReadTokens / total) * 100) : 0;
  const p = pricingFor(model);
  const cost =
    acc.inputTokens * p.input +
    acc.cacheWriteTokens * p.cacheWrite +
    acc.cacheReadTokens * p.cacheRead +
    acc.outputTokens * p.output;

  process.stderr.write(
    `[koa] tokens — input: ${acc.inputTokens} | cached: ${acc.cacheReadTokens} (${cachePct}%) | output: ${acc.outputTokens} | est_cost: $${cost.toFixed(4)}\n` +
    `[koa] context — spiderbrain: ${context.spiderBrain ? 'YES' : 'NO'} | backlog: ${context.backlog ? 'YES' : 'NO'} | state: ${context.state ? 'YES' : 'NO'} | handoff: ${context.handoff ? 'YES' : 'NO'}\n`,
  );
}

export class AgentLoop {
  private client: Anthropic;
  private registry: ToolRegistry;
  private engram: EngramClient;
  private sb: SpiderBrainClient;
  private config: KoaConfig;
  private state: AgentState;
  private usage: UsageTracker;
  private memories: MemoryEntry[] = [];
  private responseCache = new ResponseCache();
  private _projectDocGeneration?: Promise<void>;
  private _checkpointInProgress = false;
  private _checkpointTimer: ReturnType<typeof setInterval> | undefined = undefined;

  constructor(
    config: KoaConfig,
    registry: ToolRegistry,
    engram: EngramClient,
    usage: UsageTracker,
    sb: SpiderBrainClient,
  ) {
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
    // Engram + SpiderBrain structural context
    if (this.config.engramEnabled) {
      await this.engram.sync();
      this.state.engramContext = await this.engram.getContext();
      await this.engram.startSession(this.state.engramContext.goal);
      void this.engram.autoIndex();
    }
    this.state.spiderBrainContext = await this.sb.getContext();
    void this.sb.autoMolt();

    // Working memory
    ensureProjectMemoryDir(this.config.projectPath);
    const paths = projectMemoryPaths(this.config.projectPath);

    const projectMd = readMarkdownFile(paths.projectMd);
    const stateMd = readMarkdownFile(paths.stateMd);
    const backlogMd = readMarkdownFile(paths.backlogMd);
    const handoffMd = readMarkdownFile(paths.handoffMd);
    const journals = readRecentJournals(this.config.projectPath, 3);

    this.state.projectMemory = {
      ...(projectMd !== null ? { project: projectMd } : {}),
      ...(stateMd !== null ? { state: stateMd } : {}),
      ...(backlogMd !== null ? { backlog: backlogMd } : {}),
      ...(handoffMd !== null ? { handoff: handoffMd } : {}),
      journals,
    };

    // Generate PROJECT.md on first session — fire-and-forget, completes in background
    if (projectMd === null && this.config.apiKey) {
      this._projectDocGeneration = generateProjectDoc(
        this.config.projectPath,
        this.state.spiderBrainContext,
        this.config.apiKey,
      ).then((doc) => {
        writeMarkdownFile(paths.projectMd, doc);
        if (this.state.projectMemory) this.state.projectMemory.project = doc;
      }).catch((err: unknown) => {
        process.stderr.write(
          `[Koa] PROJECT.md generation failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    }

    this.memories = loadMemories();

    if (this.config.autoCheckpointMinutes > 0) {
      const ms = this.config.autoCheckpointMinutes * 60_000;
      this._checkpointTimer = setInterval(() => { this._autoCheckpoint(); }, ms);
      this._checkpointTimer.unref?.();
    }
  }

  /**
   * Builds layered system prompt as multiple content blocks with cache breakpoints:
   *   Block 1 (cached): static persona + global memories — never changes
   *   Block 2 (cached): project memory (project doc, state, journals, handoff) — stable within session
   *   Block 3 (no cache): dynamic context (Engram, SpiderBrain if code query, Backlog if planning)
   */
  private buildSystemBlocks(userMessage: string): {
    blocks: Anthropic.TextBlockParam[];
    injectedSpiderBrain: boolean;
    injectedBacklog: boolean;
    hasState: boolean;
    hasHandoff: boolean;
  } {
    // Block 1: static prefix — persona + global Engram memories
    const staticParts = [SYSTEM_BASE];
    const memoryInjection = buildMemoryPromptInjection(this.memories);
    if (memoryInjection) staticParts.push(memoryInjection);

    const block1: Anthropic.TextBlockParam = {
      type: 'text',
      text: staticParts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    };

    // Block 2: stable project memory (no backlog — that's dynamic)
    const pm = this.state.projectMemory;
    const pmParts: string[] = [];
    if (pm) {
      if (pm.project) pmParts.push(`<project_memory>\n${escapeXml(pm.project)}\n</project_memory>`);
      if (pm.state) pmParts.push(`<project_state>\n${escapeXml(pm.state)}\n</project_state>`);
      if (pm.journals && pm.journals.length > 0) {
        pmParts.push(`<recent_sessions>\n${pm.journals.map(escapeXml).join('\n\n---\n\n')}\n</recent_sessions>`);
      }
      if (pm.handoff) pmParts.push(`<handoff>\n${escapeXml(pm.handoff)}\n</handoff>`);
    }

    // Block 3: dynamic context — varies per turn
    const injectSpiderBrain = isCodeQuery(userMessage);
    const injectBacklog = !!(pm?.backlog && hasBacklogSignals(userMessage));
    const dynamicParts: string[] = [];

    const engramInjection = this.engram.buildSystemPromptInjection(this.state.engramContext);
    if (engramInjection) dynamicParts.push(engramInjection);

    if (injectSpiderBrain && this.state.spiderBrainContext) {
      const sbInjection = this.sb.buildSystemPromptInjection(this.state.spiderBrainContext);
      if (sbInjection) dynamicParts.push(sbInjection);
    }

    if (injectBacklog && pm?.backlog) {
      dynamicParts.push(`<backlog>\n${escapeXml(pm.backlog)}\n</backlog>`);
    }

    const blocks: Anthropic.TextBlockParam[] = [block1];

    if (pmParts.length > 0) {
      blocks.push({
        type: 'text',
        text: pmParts.join('\n\n'),
        cache_control: { type: 'ephemeral' },
      });
    }

    if (dynamicParts.length > 0) {
      blocks.push({ type: 'text', text: dynamicParts.join('\n\n') });
    }

    return {
      blocks,
      injectedSpiderBrain: injectSpiderBrain,
      injectedBacklog: injectBacklog,
      hasState: !!(pm?.state),
      hasHandoff: !!(pm?.handoff),
    };
  }

  private maybeCompact(): void {
    this.state.messages = compactMessages(
      this.state.messages,
      this.config.compactAfterTurns * 2,
    );
  }

  private buildConversationSummary(): string {
    const lines: string[] = [];
    for (const msg of this.state.messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        lines.push(`User: ${msg.content}`);
      } else if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'text' && block.text) {
            lines.push(`Assistant: ${block.text.slice(0, 200)}`);
          } else if (block.type === 'tool_use') {
            lines.push(`[Tool: ${block.name}]`);
          }
        }
      }
    }
    return lines.join('\n').slice(0, 4000);
  }

  async turn(userMessage: string, callbacks?: TurnCallbacks): Promise<TurnResult> {
    if (this.config.smartRouting) callbacks?.onClassifying?.();
    const { model: selectedModel, tier, cleanMessage, classifierLatencyMs, classifierUsage } = await selectModel(
      userMessage,
      this.state.messages.filter((m) => m.role === 'assistant').length,
      { model: this.config.model, smartRouting: this.config.smartRouting },
      this.client,
    );
    if (this.config.smartRouting) callbacks?.onClassified?.(tier);

    this.state.messages.push({ role: 'user', content: cleanMessage });
    this.state.turnCount++;

    const { blocks, injectedSpiderBrain, injectedBacklog, hasState, hasHandoff } =
      this.buildSystemBlocks(cleanMessage);

    const system = blocks;

    const tools = this.registry.toAnthropicTools();
    if (tools.length > 0) {
      tools[tools.length - 1] = {
        ...tools[tools.length - 1]!,
        cache_control: { type: 'ephemeral' as const },
      };
    }

    // Phase 4: check response cache (skip if noCache flag set)
    const systemHash = crypto.createHash('sha256').update(blocks[0]!.text).digest('hex').slice(0, 16);
    const cacheKey = ResponseCache.key(systemHash, cleanMessage);
    if (!this.config.noCache) {
      const cached = this.responseCache.get(cacheKey);
      if (cached) {
        process.stderr.write(`[koa] cache HIT\n`);
        this.state.messages.push({ role: 'assistant', content: [{ type: 'text', text: cached }] });
        return {
          content: cached,
          toolUses: [],
          stopReason: 'end_turn',
          model: selectedModel,
          tier,
          usage: { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, model: selectedModel },
          ...(classifierLatencyMs !== undefined ? { classifierLatencyMs } : {}),
        };
      }
    }

    const acc = { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

    const toolUses: ToolUse[] = [];
    let finalContent = '';
    let stopReason = 'end_turn';

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
          let result: ToolResultContent;
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
            const displayResult = typeof result === 'string' ? result : `[${block.name} returned binary content]`;
            callbacks?.onToolResult?.(block.name, displayResult);
          }

          if (typeof result === 'string' && result.length > this.config.maxToolOutputChars) {
            result =
              result.slice(0, this.config.maxToolOutputChars) +
              `\n[truncated — ${result.length} total chars]`;
          }

          const resultSummary = typeof result === 'string' ? result : `[binary content]`;
          toolUses.push({ id: block.id, name: block.name, input: toolInput, result: resultSummary });
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
    if (classifierUsage) {
      this.usage.addClassifierCall(classifierUsage.inputTokens, classifierUsage.outputTokens);
    }
    this.state.usage = this.usage.getStats();
    this.state.lastModel = selectedModel;
    this.state.lastTier = tier;
    this.maybeCompact();

    logUsage(acc, selectedModel, {
      spiderBrain: injectedSpiderBrain,
      backlog: injectedBacklog,
      state: hasState,
      handoff: hasHandoff,
    });

    // Store in response cache only when no tool calls occurred (tool results are side-effectful)
    if (!this.config.noCache && toolUses.length === 0 && finalContent) {
      this.responseCache.set(cacheKey, finalContent);
    }

    if (
      this.config.autoCheckpointTurns > 0 &&
      this.state.turnCount % this.config.autoCheckpointTurns === 0
    ) {
      this._autoCheckpoint();
    }

    return {
      content: finalContent,
      toolUses,
      stopReason,
      model: selectedModel,
      tier,
      usage: { ...acc, model: selectedModel },
      ...(classifierLatencyMs !== undefined ? { classifierLatencyMs } : {}),
    };
  }

  private _autoCheckpoint(): void {
    if (this._checkpointInProgress) return;
    if (this.state.turnCount === 0) return;
    this._checkpointInProgress = true;
    process.stderr.write(`[Koa] auto-checkpoint starting (turn ${this.state.turnCount})\n`);
    this.checkpoint()
      .then(() => {
        process.stderr.write('[Koa] auto-checkpoint complete\n');
      })
      .catch((err: unknown) => {
        process.stderr.write(
          `[Koa] auto-checkpoint failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      })
      .finally(() => {
        this._checkpointInProgress = false;
      });
  }

  async checkpoint(): Promise<void> {
    if (!this.config.apiKey || this.state.turnCount === 0) return;
    const summary = this.buildConversationSummary();
    const paths = projectMemoryPaths(this.config.projectPath);
    const stateMd = await generateStateDoc(summary, this.state.turnCount, this.config.apiKey);
    writeMarkdownFile(paths.stateMd, stateMd);
    if (this.state.projectMemory) this.state.projectMemory.state = stateMd;
    void sendNtfyNotification(
      'Koa checkpoint',
      `Turn ${this.state.turnCount} — STATE.md updated`,
    );
  }

  async finalize(): Promise<void> {
    if (this._checkpointTimer !== undefined) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = undefined;
    }
    if (this.state.turnCount === 0) return;

    // Wait for first-session PROJECT.md generation (10s timeout)
    if (this._projectDocGeneration) {
      await Promise.race([
        this._projectDocGeneration,
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }

    if (!this.config.apiKey) {
      if (this.config.engramEnabled) {
        await this.engram.rememberSession(`${this.state.turnCount} turns`);
      }
      return;
    }

    const summary = this.buildConversationSummary();
    const paths = projectMemoryPaths(this.config.projectPath);

    await Promise.all([
      generateStateDoc(summary, this.state.turnCount, this.config.apiKey).then((doc) => {
        writeMarkdownFile(paths.stateMd, doc);
      }),
      generateJournalEntry(summary, this.state.turnCount, this.config.apiKey).then((entry) => {
        appendJournalEntry(this.config.projectPath, entry);
      }),
    ]);

    if (this.config.engramEnabled) {
      await this.engram.rememberSession(`${this.state.turnCount} turns. ${summary.slice(0, 200)}`);
    }
  }

  getState(): Readonly<AgentState> {
    return this.state;
  }

  getTools(): Array<{ name: string; description: string }> {
    return this.registry.getAll().map((t) => ({ name: t.name, description: t.description }));
  }

  async rebuildBrain(): Promise<string> {
    return this.sb.molt();
  }
}
