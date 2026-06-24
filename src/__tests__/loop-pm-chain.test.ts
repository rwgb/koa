/**
 * GAP-14 — PM auto-chaining mini-loop coverage.
 *
 * Tests the shouldAutoChain-gated PM mini-loop at lines 982–1063 of
 * src/agent/loop.ts. The main loop uses provider.stream() and the PM
 * chained call uses provider.create(), so both are controlled here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import type { LlmProvider, LlmStream } from '../agent/providers/types.js';

// ── Module mocks (mirrors loop_turn.test.ts baseline) ────────────────────────

vi.mock('../project-memory/store.js', () => ({
  ensureProjectMemoryDir: vi.fn(),
  readMarkdownFile: vi.fn().mockReturnValue(null),
  writeMarkdownFile: vi.fn(),
  appendJournalEntry: vi.fn(),
  readRecentJournals: vi.fn().mockReturnValue([]),
}));

vi.mock('../project-memory/paths.js', () => ({
  projectMemoryPaths: vi.fn().mockReturnValue({
    projectMd: '/tmp/PROJECT.md',
    stateMd: '/tmp/STATE.md',
    backlogMd: '/tmp/BACKLOG.md',
    handoffMd: '/tmp/HANDOFF.md',
    journalDir: '/tmp/journal',
  }),
}));

vi.mock('../project-memory/generators/project-doc.js', () => ({
  generateProjectDoc: vi.fn().mockResolvedValue('# PROJECT'),
}));

vi.mock('../project-memory/generators/state-doc.js', () => ({
  generateStateDoc: vi.fn().mockResolvedValue('## State'),
  generateJournalEntry: vi.fn().mockResolvedValue('## Journal'),
}));

vi.mock('../memory/store.js', () => ({
  loadMemories: vi.fn().mockReturnValue([]),
  buildMemoryPromptInjection: vi.fn().mockReturnValue(''),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: vi.fn() };
  },
  BadRequestError: class extends Error { status = 400; },
}));

vi.mock('../engram/signals.js', () => ({
  readRecentSignals: vi.fn().mockReturnValue([]),
}));

vi.mock('../engram/preferences.js', () => ({
  loadPreferences: vi.fn().mockReturnValue([]),
  buildPreferencesBlock: vi.fn().mockReturnValue(''),
  extractAndMergePreferences: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/index.js', () => ({
  createConversation: vi.fn().mockReturnValue({ id: 'conv-1' }),
  addConversationTurn: vi.fn(),
  closeConversation: vi.fn(),
  getConversationTurns: vi.fn().mockReturnValue([]),
  updateConversationTitle: vi.fn(),
  getProjectBySlug: vi.fn().mockReturnValue(null),
  getProjectBudget: vi.fn().mockReturnValue(null),
  getProjectCumulativeCost: vi.fn().mockReturnValue(0),
}));

vi.mock('../channels/router.js', () => ({
  routeResponse: vi.fn(),
}));

vi.mock('../analytics/forecasting.js', () => ({
  computeForecast: vi.fn().mockReturnValue({ globalTaskCount: 0 }),
  buildForecastSummaryText: vi.fn().mockReturnValue(''),
}));

vi.mock('../analytics/streaks.js', () => ({
  buildWeeklyReport: vi.fn().mockReturnValue({}),
  buildWeeklyReportSummary: vi.fn().mockReturnValue(''),
}));

vi.mock('../analytics/proactive.js', () => ({
  buildProactiveAlerts: vi.fn().mockReturnValue([]),
  buildProactiveAlertsText: vi.fn().mockReturnValue(''),
}));

vi.mock('../calendar/conflicts.js', () => ({
  buildCalendarSummary: vi.fn().mockReturnValue(''),
}));

vi.mock('../calendar/oauth.js', () => ({
  isCalendarConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn().mockReturnValue([]),
}));

// shouldAutoChain is mocked per-test to control the chain gate
vi.mock('../agent/chaining.js', () => ({
  shouldAutoChain: vi.fn().mockReturnValue(false),
  buildPmFollowUpPrompt: vi.fn().mockReturnValue('PM follow-up prompt'),
}));

vi.mock('../agent/select-agent.js', () => ({
  // Always route to code-assistant so shouldAutoChain's agent check passes
  selectAgent: vi.fn().mockReturnValue('code-assistant'),
  isCodeQuery: vi.fn().mockReturnValue(false),
  hasBacklogSignals: vi.fn().mockReturnValue(false),
}));

vi.mock('../agent/specialists.js', () => ({
  buildAgentSpecs: vi.fn().mockReturnValue({
    'code-assistant': {
      model: 'claude-sonnet-4-5',
      systemAddition: 'You are a coding assistant.',
      agentPrompt: '',
    },
    'project-manager': {
      model: 'claude-sonnet-4-5',
      systemAddition: 'You are a PM.',
      agentPrompt: '',
    },
    'life-manager': {
      model: 'claude-sonnet-4-5',
      systemAddition: 'You are a life manager.',
      agentPrompt: '',
    },
  }),
}));

vi.mock('../spiderbrain/client.js', () => ({
  SpiderBrainClient: class {
    getContext = vi.fn().mockResolvedValue(null);
    autoMolt = vi.fn().mockResolvedValue(undefined);
    isAvailable = vi.fn().mockReturnValue(false);
    buildSystemPromptInjection = vi.fn().mockReturnValue('');
  },
}));

vi.mock('../agent/providers/index.js', () => ({
  createProvider: vi.fn().mockReturnValue({
    stream: vi.fn(),
    create: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<KoaConfig> = {}): KoaConfig {
  return {
    model: 'claude-sonnet-4-5',
    maxTokens: 8096,
    projectPath: '/tmp/test-project',
    engramEnabled: false,
    apiKey: 'sk-test',
    smartRouting: false,
    maxToolOutputChars: 12000,
    autoCheckpointTurns: 0,
    autoCheckpointMinutes: 0,
    noCache: true,
    autoChaining: true, // must be true for the PM chain gate to be evaluated
    briefingEnabled: false,
    briefingTime: '08:00',
    ttsProvider: 'say',
    userName: 'User',
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
    elevenLabsModel: 'eleven_turbo_v2_5',
    provider: 'anthropic' as const,
    ollamaModel: 'llama3.2',
    ollamaBaseUrl: 'http://localhost:11434',
    claudeCodePath: 'claude',
    quotaFallback: true,
    sandboxBackend: 'local' as const,
    sandboxTimeoutMs: 10000,
    browserEnabled: false,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeLoop(configOverrides: Partial<KoaConfig> = {}): any {
  const config = makeConfig(configOverrides);
  const registry = {
    toAnthropicTools: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(undefined),
    register: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
  };
  const engram = {
    sync: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn().mockResolvedValue({ hotFiles: [], masterFiles: [] }),
    startSession: vi.fn().mockResolvedValue(undefined),
    autoIndex: vi.fn().mockResolvedValue(undefined),
    buildSystemPromptInjection: vi.fn().mockReturnValue(''),
    rememberSession: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(''),
  };
  const usage = {
    addTurn: vi.fn(),
    addClassifierCall: vi.fn(),
    getStats: vi.fn().mockReturnValue({ totalInputTokens: 0, totalOutputTokens: 0, turns: 0 }),
  };
  const sb = {
    getContext: vi.fn().mockResolvedValue(null),
    autoMolt: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockReturnValue(false),
    buildSystemPromptInjection: vi.fn().mockReturnValue(''),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentLoop(config, registry as any, engram as any, usage as any, sb as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textBlock = (text: string): any => ({ type: 'text', text });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMessage(overrides: Record<string, any> = {}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [textBlock('hello')],
    model: 'claude-sonnet-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function makeStream(message: Anthropic.Message): LlmStream {
  const textBlocks = message.content.filter(
    (b): b is Anthropic.TextBlock => b.type === 'text',
  );
  return {
    on(event: string, listener: (text: string) => void) {
      if (event === 'text') {
        for (const b of textBlocks) {
          listener(b.text);
        }
      }
      return this;
    },
    finalMessage: () => Promise.resolve(message),
  };
}

function makeToolUseBlock(toolId: string, toolName: string): Anthropic.ToolUseBlock {
  return {
    type: 'tool_use',
    id: toolId,
    name: toolName,
    input: { path: '/tmp/test.txt' },
  } as Anthropic.ToolUseBlock;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PM auto-chaining mini-loop (GAP-14)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chainMod: any;

  beforeEach(async () => {
    chainMod = await import('../agent/chaining.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('populates chainedResult when shouldAutoChain returns true and PM ends immediately', async () => {
    // shouldAutoChain → true so the PM branch executes
    vi.mocked(chainMod.shouldAutoChain).mockReturnValue(true);
    vi.mocked(chainMod.buildPmFollowUpPrompt).mockReturnValue('PM follow-up prompt');

    const loop = makeLoop();

    // Main-loop: stream() returns a simple end_turn message
    const mainMsg = makeMessage({
      content: [textBlock('The feature is implemented and all tests pass.')],
      stop_reason: 'end_turn',
    });
    loop.provider = {
      stream: vi.fn().mockReturnValue(makeStream(mainMsg)),
      // PM create() returns an end_turn response immediately (no tool use)
      create: vi.fn().mockResolvedValue(
        makeMessage({
          content: [textBlock('PM notes: marking task as done.')],
          stop_reason: 'end_turn',
          usage: { input_tokens: 5, output_tokens: 8, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
      ),
    };

    const result = await loop.turn('implement the feature', {});

    // chainedResult must be set
    expect(result.chainedResult).toBeDefined();
    expect(result.chainedResult!.agent).toBe('project-manager');
    expect(result.chainedResult!.content).toContain('PM notes: marking task as done.');

    // provider.create must have been called (PM mini-loop fired)
    expect(loop.provider.create).toHaveBeenCalledOnce();
  });

  it('executes a PM tool call and feeds tool_result back before the final PM text', async () => {
    vi.mocked(chainMod.shouldAutoChain).mockReturnValue(true);
    vi.mocked(chainMod.buildPmFollowUpPrompt).mockReturnValue('PM follow-up prompt');

    const loop = makeLoop();

    // Register a mock tool that the PM will call
    const toolExecute = vi.fn().mockResolvedValue('task updated successfully');
    loop.registry.get = vi.fn().mockReturnValue({
      name: 'update_task',
      execute: toolExecute,
    });

    // Main-loop stream: end_turn
    const mainMsg = makeMessage({
      content: [textBlock('The fix is complete and merged.')],
      stop_reason: 'end_turn',
    });

    // PM first call: returns tool_use so the mini-loop continues
    const pmToolUseMsg = makeMessage({
      content: [
        textBlock('I will update the task.'),
        makeToolUseBlock('pm-tool-1', 'update_task'),
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    // PM second call: end_turn with final summary text
    const pmEndMsg = makeMessage({
      content: [textBlock('Task board updated: issue closed.')],
      stop_reason: 'end_turn',
      usage: { input_tokens: 8, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    let createCallCount = 0;
    loop.provider = {
      stream: vi.fn().mockReturnValue(makeStream(mainMsg)),
      create: vi.fn().mockImplementation(() => {
        createCallCount++;
        return Promise.resolve(createCallCount === 1 ? pmToolUseMsg : pmEndMsg);
      }),
    };

    const result = await loop.turn('fix the regression', {});

    // Tool must have been executed by the PM mini-loop
    expect(toolExecute).toHaveBeenCalledOnce();
    expect(toolExecute).toHaveBeenCalledWith({ path: '/tmp/test.txt' });

    // Two PM create() calls: one for tool_use, one for the follow-up
    expect(loop.provider.create).toHaveBeenCalledTimes(2);

    // chainedResult must include the final PM summary
    expect(result.chainedResult).toBeDefined();
    expect(result.chainedResult!.content).toContain('Task board updated: issue closed.');
    expect(result.chainedResult!.agent).toBe('project-manager');
  });

  it('does NOT populate chainedResult when shouldAutoChain returns false', async () => {
    // Leave shouldAutoChain returning false (the module-level default)
    vi.mocked(chainMod.shouldAutoChain).mockReturnValue(false);

    const loop = makeLoop();

    const mainMsg = makeMessage({
      content: [textBlock('Here is some information.')],
      stop_reason: 'end_turn',
    });
    const createSpy = vi.fn();
    loop.provider = {
      stream: vi.fn().mockReturnValue(makeStream(mainMsg)),
      create: createSpy,
    };

    const result = await loop.turn('tell me something', {});

    expect(result.chainedResult).toBeUndefined();
    // provider.create must NOT have been invoked — PM mini-loop never ran
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('does NOT populate chainedResult when autoChaining config is false', async () => {
    vi.mocked(chainMod.shouldAutoChain).mockReturnValue(true);

    // autoChaining: false overrides the mock — the branch is never entered
    const loop = makeLoop({ autoChaining: false });

    const mainMsg = makeMessage({
      content: [textBlock('All done.')],
      stop_reason: 'end_turn',
    });
    const createSpy = vi.fn();
    loop.provider = {
      stream: vi.fn().mockReturnValue(makeStream(mainMsg)),
      create: createSpy,
    };

    const result = await loop.turn('do something', {});

    expect(result.chainedResult).toBeUndefined();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('invokes onChainStart callback with project-manager when chaining fires', async () => {
    vi.mocked(chainMod.shouldAutoChain).mockReturnValue(true);

    const loop = makeLoop();

    const mainMsg = makeMessage({
      content: [textBlock('The implementation is complete.')],
      stop_reason: 'end_turn',
    });
    loop.provider = {
      stream: vi.fn().mockReturnValue(makeStream(mainMsg)),
      create: vi.fn().mockResolvedValue(
        makeMessage({
          content: [textBlock('PM: tasks updated.')],
          stop_reason: 'end_turn',
          usage: { input_tokens: 4, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
      ),
    };

    const onChainStart = vi.fn();
    await loop.turn('finish the work', { onChainStart });

    expect(onChainStart).toHaveBeenCalledWith('project-manager');
  });
});
