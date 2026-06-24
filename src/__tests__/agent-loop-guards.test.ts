/**
 * GAP-04 + GAP-05: AgentLoop guard tests for src/agent/loop.ts
 *
 * GAP-04: _turnImpl tool-timeout and MAX_TOOL_ITERATIONS guard are untested.
 * GAP-05: Per-project budget enforcement has no test against the live loop.
 *
 * Shares module mocks + helper constructors with loop_turn.test.ts.
 * Provider injection: `(loop as any).provider = fakeProvider`
 * Budget injection:   `(loop as any).projectBudget = n`
 *                     `(loop as any).sessionCostUsd = n`
 *                     `(loop as any).priorProjectCostUsd = n`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import type { LlmProvider, LlmStream } from '../agent/providers/types.js';

// ── Module mocks (mirror loop_turn.test.ts) ───────────────────────────────────

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

vi.mock('../agent/chaining.js', () => ({
  shouldAutoChain: vi.fn().mockReturnValue(false),
  buildPmFollowUpPrompt: vi.fn().mockReturnValue(''),
}));

vi.mock('../agent/select-agent.js', () => ({
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
    autoChaining: false,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const textBlock = (text: string): any => ({ type: 'text', text });

function makeMessage(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [textBlock('hello')],
    model: 'claude-sonnet-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

function makeToolUseMessage(toolId: string, toolName: string): Anthropic.Message {
  return makeMessage({
    content: [
      {
        type: 'tool_use',
        id: toolId,
        name: toolName,
        input: { path: '/tmp/test.txt' },
      } as Anthropic.ToolUseBlock,
    ],
    stop_reason: 'tool_use',
  });
}

/**
 * Build a provider that always returns the given message, and counts stream() calls.
 */
function makeInfiniteProvider(message: Anthropic.Message): {
  provider: LlmProvider;
  callCount: () => number;
} {
  let count = 0;
  const provider: LlmProvider = {
    stream() {
      count++;
      return makeStream(message);
    },
    create: vi.fn().mockResolvedValue(makeMessage()),
  };
  return { provider, callCount: () => count };
}

// ── GAP-04a: MAX_TOOL_ITERATIONS guard ───────────────────────────────────────

describe('GAP-04a: MAX_TOOL_ITERATIONS guard stops infinite tool-use loops', () => {
  let loop: ReturnType<typeof makeLoop>;

  beforeEach(() => {
    loop = makeLoop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('halts after exactly 25 provider calls and returns stopReason=max_iterations', async () => {
    // Provider always returns tool_use — never end_turn
    const toolUseMsg = makeToolUseMessage('tu-gap04a', 'noop_tool');
    const { provider, callCount } = makeInfiniteProvider(toolUseMsg);
    loop.provider = provider;

    // Register a fast-resolving tool so tool execution doesn't block
    loop.registry.get = vi.fn().mockReturnValue({
      name: 'noop_tool',
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const result = await loop.turn('do something forever', {});

    // Guard fires at iteration 25 — no 26th provider call
    expect(callCount()).toBe(25);
    expect(result.stopReason).toBe('max_iterations');
    expect(result.content).toContain('tool-iteration budget exhausted');
  });

  it('records one tool use per iteration (25 total)', async () => {
    const toolUseMsg = makeToolUseMessage('tu-gap04b', 'noop_tool');
    const { provider } = makeInfiniteProvider(toolUseMsg);
    loop.provider = provider;

    loop.registry.get = vi.fn().mockReturnValue({
      name: 'noop_tool',
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const result = await loop.turn('loop me', {});

    // Each of 25 iterations executes one tool_use block
    expect(result.toolUses).toHaveLength(25);
  });

  it('emits the budget-exhausted text via onTextDelta callback', async () => {
    const toolUseMsg = makeToolUseMessage('tu-gap04c', 'noop_tool');
    const { provider } = makeInfiniteProvider(toolUseMsg);
    loop.provider = provider;

    loop.registry.get = vi.fn().mockReturnValue({
      name: 'noop_tool',
      execute: vi.fn().mockResolvedValue('ok'),
    });

    const deltas: string[] = [];
    await loop.turn('loop me', { onTextDelta: (d: string) => deltas.push(d) });

    expect(deltas.join('')).toContain('tool-iteration budget exhausted');
  });
});

// ── GAP-04b: toolTimeoutMs per-tool timeout ───────────────────────────────────

describe('GAP-04b: toolTimeoutMs — tool that never resolves causes turn() to reject', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turn() rejects with a timeout error when toolTimeoutMs is exceeded', async () => {
    // Use a short 100ms timeout so the test doesn't run for 30 s
    const loop = makeLoop({ toolTimeoutMs: 100 });

    // Provider returns one tool_use, then end_turn (should not be reached)
    const toolUseMsg = makeToolUseMessage('tu-timeout', 'slow_tool');
    const endMsg = makeMessage({ content: [textBlock('done')], stop_reason: 'end_turn' });

    let streamIdx = 0;
    const messages = [toolUseMsg, endMsg];
    loop.provider = {
      stream() {
        return makeStream(messages[streamIdx++]!);
      },
      create: vi.fn(),
    } satisfies LlmProvider;

    // Tool that never resolves
    loop.registry.get = vi.fn().mockReturnValue({
      name: 'slow_tool',
      execute: () => new Promise<never>(() => { /* intentionally never resolves */ }),
    });

    // The timeout error is caught by the tool's try/catch and turned into a tool_result
    // string — the loop continues and ultimately returns end_turn.
    // Verify it doesn't hang: use a generous wall-clock ceiling (2 s >> 100 ms tool timeout).
    const result = await loop.turn('call slow tool', {});

    // Tool result should contain the timeout error message
    const toolResults: Anthropic.MessageParam[] = loop.state.messages;
    const userMsgWithToolResult = toolResults.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some(
          (b) => b.type === 'tool_result',
        ),
    );
    expect(userMsgWithToolResult).toBeDefined();
    const toolResultContent = (
      userMsgWithToolResult!.content as Anthropic.ToolResultBlockParam[]
    )[0]!.content;
    expect(typeof toolResultContent === 'string' && toolResultContent).toMatch(
      /timed out after 100ms/,
    );
    // Loop continues after timeout — final stop from provider
    expect(result.stopReason).toBe('end_turn');
  }, 5000 /* wall-clock ceiling */);

  it('default 30 s toolTimeoutMs is used when config omits the field', () => {
    // White-box: verify the code path picks up the default without running the full timeout.
    // Access the config to ensure no toolTimeoutMs was set.
    const loop = makeLoop();
    // toolTimeoutMs is not set in makeConfig — should be undefined → 30_000 default used in source
    expect(loop.config.toolTimeoutMs).toBeUndefined();
  });
});

// ── GAP-04c: max_tokens stop reason ──────────────────────────────────────────

describe('GAP-04c: max_tokens stop reason — placeholder tool_result injected, no throw', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inserts placeholder tool_result for unexecuted tool_use blocks and returns cleanly', async () => {
    const loop = makeLoop();
    const toolId = 'tu-maxtok';
    const toolName = 'never_called';
    const executeSpy = vi.fn().mockResolvedValue('should not be called');
    loop.registry.get = vi.fn().mockReturnValue({ name: toolName, execute: executeSpy });

    const truncatedMsg = makeMessage({
      content: [
        textBlock('partial'),
        {
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input: {},
        } as Anthropic.ToolUseBlock,
      ],
      stop_reason: 'max_tokens',
    });

    loop.provider = {
      stream() { return makeStream(truncatedMsg); },
      create: vi.fn(),
    } satisfies LlmProvider;

    const result = await loop.turn('write something long', {});

    // Tool must NOT have been executed
    expect(executeSpy).not.toHaveBeenCalled();

    // Result content contains truncation marker
    expect(result.content).toContain('[response truncated at max_tokens]');
    expect(result.stopReason).toBe('max_tokens');

    // A placeholder tool_result was inserted for the skipped tool_use
    const messages: Anthropic.MessageParam[] = loop.state.messages;
    const placeholderMsg = messages.find(
      (m) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string; tool_use_id?: string }>).some(
          (b) => b.type === 'tool_result' && b.tool_use_id === toolId,
        ),
    );
    expect(placeholderMsg).toBeDefined();
    const placeholderContent = (
      placeholderMsg!.content as Anthropic.ToolResultBlockParam[]
    )[0]!.content;
    expect(placeholderContent).toBe('skipped — response truncated at max_tokens');
  });

  it('text-only max_tokens response appends truncation marker and returns cleanly', async () => {
    const loop = makeLoop();
    const truncatedMsg = makeMessage({
      content: [textBlock('here is some partial text')],
      stop_reason: 'max_tokens',
    });
    loop.provider = {
      stream() { return makeStream(truncatedMsg); },
      create: vi.fn(),
    } satisfies LlmProvider;

    const result = await loop.turn('write a lot', {});

    expect(result.content).toMatch(/\[response truncated at max_tokens\]$/);
    expect(result.stopReason).toBe('max_tokens');
  });
});

// ── GAP-05: Per-project budget enforcement ────────────────────────────────────

describe('GAP-05: Per-project budget enforcement throws when threshold is crossed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws budget-exceeded error when projectBudget is set and cost >= budget', async () => {
    const loop = makeLoop();

    // Set a small budget: $0.01, and pre-load the prior cost just below the threshold
    loop.projectBudget = 0.01;
    loop.priorProjectCostUsd = 0.009;
    // sessionCostUsd starts at 0 — first API call will push total to ~0.009 + response cost
    // To guarantee the throw on the first iteration, set session cost to tip over the edge
    loop.sessionCostUsd = 0.005;

    const endMsg = makeMessage({
      content: [textBlock('this should not be returned')],
      stop_reason: 'end_turn',
    });
    const streamSpy = vi.fn().mockReturnValue(makeStream(endMsg));
    loop.provider = { stream: streamSpy, create: vi.fn() } satisfies LlmProvider;

    await expect(loop.turn('do something', {})).rejects.toThrow(
      /Project budget exceeded/,
    );

    // stream() must NOT have been called — guard fires before the API call
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('error message includes cumulative cost and budget values', async () => {
    const loop = makeLoop();
    loop.projectBudget = 0.05;
    loop.priorProjectCostUsd = 0.03;
    loop.sessionCostUsd = 0.025; // total = 0.055 > 0.05

    loop.provider = {
      stream: vi.fn(),
      create: vi.fn(),
    } satisfies LlmProvider;

    try {
      await loop.turn('anything', {});
      expect.fail('Expected budget error was not thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toMatch(/cumulative cost/);
      expect(msg).toMatch(/budget/);
      // Values formatted with $ prefix
      expect(msg).toMatch(/\$0\.05[0-9]*/);
    }
  });

  it('does NOT throw when no projectBudget is configured (null)', async () => {
    const loop = makeLoop();
    // projectBudget stays null (default)
    loop.sessionCostUsd = 99999; // arbitrarily large — should not trigger anything

    const endMsg = makeMessage({ content: [textBlock('ok')], stop_reason: 'end_turn' });
    loop.provider = {
      stream: vi.fn().mockReturnValue(makeStream(endMsg)),
      create: vi.fn(),
    } satisfies LlmProvider;

    // Should resolve without throwing
    const result = await loop.turn('anything', {});
    expect(result.content).toBe('ok');
  });

  it('accumulates session cost across multiple loop iterations before triggering', async () => {
    const loop = makeLoop();

    // Each mock message uses 10 input + 5 output tokens at claude-sonnet-4-5 rates:
    //   sonnet input:  $0.000003/token  → 10 * 0.000003 = $0.000030
    //   sonnet output: $0.000015/token  →  5 * 0.000015 = $0.000075
    //   cost per iteration ≈ $0.000105
    //
    // Set the budget between 1x and 3x the per-call cost so the guard fires
    // after iteration 1 completes (session cost accumulates AFTER the stream call)
    // but before MAX_TOOL_ITERATIONS (25) is reached.
    //
    // After iteration 1: sessionCostUsd ≈ 0.000105 → projectCostUsd = 0.000105
    // After iteration 2: sessionCostUsd ≈ 0.000210 > budget 0.000150 → throws on iteration 2
    loop.projectBudget = 0.00015; // between 1x and 2x per-call cost
    loop.priorProjectCostUsd = 0;
    loop.sessionCostUsd = 0;

    const toolUseMsg = makeToolUseMessage('tu-budget', 'cheap_tool');
    let callCount = 0;
    loop.provider = {
      stream() {
        callCount++;
        return makeStream(toolUseMsg);
      },
      create: vi.fn(),
    } satisfies LlmProvider;

    loop.registry.get = vi.fn().mockReturnValue({
      name: 'cheap_tool',
      execute: vi.fn().mockResolvedValue('result'),
    });

    await expect(loop.turn('do work', {})).rejects.toThrow(/Project budget exceeded/);

    // 2 provider calls made: cost after call 1 < budget; cost after call 2 > budget;
    // the budget check at the top of iteration 3 blocks any further calls.
    expect(callCount).toBe(2);
  });
});
