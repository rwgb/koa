import Anthropic from '@anthropic-ai/sdk';
import type { AgentState, TurnResult, ToolUse, ToolInput } from '../types/index.js';
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
import { projectMemoryPaths } from '../project-memory/paths.js';
import { generateProjectDoc } from '../project-memory/generators/project-doc.js';
import { generateStateDoc, generateJournalEntry } from '../project-memory/generators/state-doc.js';

export interface TurnCallbacks {
  onToolCall?: (name: string, input: ToolInput) => void;
  onToolResult?: (name: string, result: string) => void;
}

const SYSTEM_BASE = `You are Koa, an expert software engineering assistant with persistent project memory.
You have access to tools for reading/writing files, running shell commands, and querying project history via Engram.
Be precise, concise, and always verify your work. Prefer editing existing files over creating new ones.`;

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

export class AgentLoop {
  private client: Anthropic;
  private registry: ToolRegistry;
  private engram: EngramClient;
  private sb: SpiderBrainClient;
  private config: KoaConfig;
  private state: AgentState;
  private usage: UsageTracker;
  private memories: MemoryEntry[] = [];
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

  private buildSystemPrompt(): string {
    const parts = [SYSTEM_BASE];

    const memoryInjection = buildMemoryPromptInjection(this.memories);
    if (memoryInjection) parts.push(memoryInjection);

    // Working memory — project context, state, journals
    if (this.state.projectMemory) {
      const pm = this.state.projectMemory;
      if (pm.project) {
        parts.push(`<project_memory>\n${escapeXml(pm.project)}\n</project_memory>`);
      }
      if (pm.state) {
        parts.push(`<project_state>\n${escapeXml(pm.state)}\n</project_state>`);
      }
      if (pm.journals && pm.journals.length > 0) {
        parts.push(`<recent_sessions>\n${pm.journals.map(escapeXml).join('\n\n---\n\n')}\n</recent_sessions>`);
      }
      if (pm.backlog) {
        parts.push(`<backlog>\n${escapeXml(pm.backlog)}\n</backlog>`);
      }
      if (pm.handoff) {
        parts.push(`<handoff>\n${escapeXml(pm.handoff)}\n</handoff>`);
      }
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

    const system: Array<Anthropic.TextBlockParam> = [
      {
        type: 'text' as const,
        text: this.buildSystemPrompt(),
        cache_control: { type: 'ephemeral' as const },
      },
    ];

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
    this.state.lastModel = selectedModel;
    this.state.lastTier = tier;
    this.maybeCompact();

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

  async rebuildBrain(): Promise<string> {
    return this.sb.molt();
  }
}
