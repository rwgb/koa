/**
 * Tests for §A audit fixes in src/agent/loop.ts and src/agent/router.ts.
 *
 * Uses a scripted fake LlmProvider whose stream() returns a queued sequence of
 * Anthropic.Message objects. Injected by replacing the loop's private `provider`
 * field via `(loop as any).provider = fakeProvider`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Anthropic from '@anthropic-ai/sdk';
import { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import type { LlmProvider, LlmStream } from '../agent/providers/types.js';
import { MODELS, selectModel } from '../agent/router.js';

// ── Module mocks ──────────────────────────────────────────────────────────────

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

// ── Test helpers ──────────────────────────────────────────────────────────────

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

/**
 * Build a fake LlmStream that emits text deltas and returns the given message.
 */
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

/**
 * Build a fake LlmProvider that returns messages from a queue.
 * Tracks all stream() call parameters for later assertion.
 */
function makeProvider(messages: Anthropic.Message[]): {
  provider: LlmProvider;
  calls: Array<{ model: string; messages: Anthropic.MessageParam[]; system: Anthropic.TextBlockParam[] }>;
} {
  const calls: Array<{ model: string; messages: Anthropic.MessageParam[]; system: Anthropic.TextBlockParam[] }> = [];
  let idx = 0;
  const provider: LlmProvider = {
    stream(params) {
      calls.push({ model: params.model, messages: params.messages, system: params.system });
      const msg = messages[idx] ?? messages[messages.length - 1]!;
      idx++;
      return makeStream(msg);
    },
    create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    } as Anthropic.Message),
  };
  return { provider, calls };
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
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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

// ── A-1: Max-iteration guard ──────────────────────────────────────────────────

describe('A-1: Max-iteration guard', () => {
  let loop: ReturnType<typeof makeLoop>;

  beforeEach(() => {
    loop = makeLoop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stops at 25 iterations with stop_reason=max_iterations', async () => {
    // Provider returns tool_use every time — creates an infinite loop without the guard
    const toolUseMsg = makeToolUseMessage('tu-1', 'read_file');
    const endMsg = makeMessage({ content: [textBlock('done')], stop_reason: 'end_turn' });

    // 25 tool_use messages, then a final end_turn (should never be reached)
    const messages = [
      ...Array(25).fill(toolUseMsg),
      endMsg,
    ];
    const { provider, calls } = makeProvider(messages);

    // Inject fake provider
    loop.provider = provider;

    // Register a no-op tool
    loop.registry.get = vi.fn().mockReturnValue({
      name: 'read_file',
      execute: vi.fn().mockResolvedValue('file content'),
    });

    const textDeltas: string[] = [];
    const result = await loop.turn('do something', {
      onTextDelta: (d: string) => textDeltas.push(d),
    });

    expect(result.stopReason).toBe('max_iterations');
    // stream() invoked exactly 25 times (the 26th call would be the end_turn, never reached)
    expect(calls).toHaveLength(25);
    // content contains the budget-exhausted message
    expect(result.content).toContain('tool-iteration budget exhausted');
    // exactly 25 tool uses recorded
    expect(result.toolUses).toHaveLength(25);
  });
});

// ── A-2: max_tokens truncation ────────────────────────────────────────────────

describe('A-2: max_tokens truncation', () => {
  let loop: ReturnType<typeof makeLoop>;

  beforeEach(() => {
    loop = makeLoop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('A-2a: text-only max_tokens response appends truncation marker', async () => {
    const truncatedMsg = makeMessage({
      content: [textBlock('partial answer')],
      stop_reason: 'max_tokens',
    });
    const { provider } = makeProvider([truncatedMsg]);
    loop.provider = provider;

    const textDeltas: string[] = [];
    const result = await loop.turn('write me a long essay', {
      onTextDelta: (d: string) => textDeltas.push(d),
    });

    expect(result.content).toMatch(/\[response truncated at max_tokens\]$/);
    expect(result.stopReason).toBe('max_tokens');
    // onTextDelta was called with the truncation marker
    expect(textDeltas.join('')).toContain('[response truncated at max_tokens]');
  });

  it('A-2b: text+tool_use max_tokens — tool execute NOT called; placeholder tool_result in messages', async () => {
    const toolId = 'tu-trunc-1';
    const toolName = 'read_file';
    const executeStub = vi.fn().mockResolvedValue('should not be called');
    loop.registry.get = vi.fn().mockReturnValue({ name: toolName, execute: executeStub });

    const truncatedMsg = makeMessage({
      content: [
        textBlock('I need to'),
        {
          type: 'tool_use',
          id: toolId,
          name: toolName,
          input: { path: '/etc/passwd' },
        } as Anthropic.ToolUseBlock,
      ],
      stop_reason: 'max_tokens',
    });
    const { provider } = makeProvider([truncatedMsg]);
    loop.provider = provider;

    await loop.turn('read a file', {});

    // tool execute must NOT have been called
    expect(executeStub).not.toHaveBeenCalled();

    // The last message in state should be a user tool_result with the skipped placeholder
    const messages: Anthropic.MessageParam[] = loop.state.messages;
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg!.role).toBe('user');
    const content = lastMsg!.content as Anthropic.ToolResultBlockParam[];
    expect(content[0]!.tool_use_id).toBe(toolId);
    expect(content[0]!.content).toBe('skipped — response truncated at max_tokens');
  });
});

// ── A-3: null anthropicClient no-throw ────────────────────────────────────────

describe('A-3: selectModel with null anthropicClient', () => {
  it('returns tier=sonnet, source=config with null client (no throw)', async () => {
    // Use a message that is 'moderate' (>120 chars but <400, no COMPLEX_RE match).
    // This would normally trigger classifyWithHaiku. With null client it falls back to sonnet.
    const moderateMsg =
      'Please explain in some detail how the authentication middleware ' +
      'handles token refresh in this codebase and where the logic lives.';
    const result = await selectModel(
      moderateMsg,
      0,
      { model: MODELS.sonnet, smartRouting: true },
      null,
    );
    expect(result.tier).toBe('sonnet');
    expect(result.source).toBe('config');
  });
});

// ── A-4: Static prompt cache order ───────────────────────────────────────────

describe('A-4: Cache-safe system block ordering', () => {
  let loop: ReturnType<typeof makeLoop>;

  beforeEach(() => {
    loop = makeLoop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('system[0] is the cached static block starting with "You are Koa"', async () => {
    const endMsg = makeMessage({ content: [textBlock('ok')], stop_reason: 'end_turn' });
    const { provider, calls } = makeProvider([endMsg]);
    loop.provider = provider;

    await loop.turn('hello', {});

    const system = calls[0]!.system;
    expect(system.length).toBeGreaterThan(0);
    const first = system[0]!;
    expect(first.type).toBe('text');
    expect(first.text).toMatch(/^You are Koa/);
    expect((first as { cache_control?: { type: string } }).cache_control?.type).toBe('ephemeral');
  });

  it('agentBlock (specialist persona) appears AFTER the last cache_control block', async () => {
    const endMsg = makeMessage({ content: [textBlock('ok')], stop_reason: 'end_turn' });
    const { provider, calls } = makeProvider([endMsg]);
    loop.provider = provider;

    await loop.turn('hello', {});

    const system = calls[0]!.system;
    // Find the last block with cache_control
    const lastCachedIdx = system.reduce(
      (last, block, idx) =>
        (block as { cache_control?: unknown }).cache_control !== undefined ? idx : last,
      -1,
    );
    // Find agentBlock: the block with the code-assistant systemAddition text
    const agentBlockIdx = system.findIndex((b) =>
      b.text === 'You are a coding assistant.',
    );

    expect(agentBlockIdx).toBeGreaterThan(-1);
    expect(agentBlockIdx).toBeGreaterThan(lastCachedIdx);
  });
});

// ── A-5: markMessageHistoryCache ─────────────────────────────────────────────

describe('A-5: markMessageHistoryCache', () => {
  let loop: ReturnType<typeof makeLoop>;

  beforeEach(() => {
    loop = makeLoop();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('last block of last message carries cache_control during stream() call (two-call turn)', async () => {
    const toolId = 'tu-a5-1';
    const toolName = 'read_file';

    loop.registry.get = vi.fn().mockReturnValue({
      name: toolName,
      execute: vi.fn().mockResolvedValue('file content'),
    });

    const toolUseMsg = makeToolUseMessage(toolId, toolName);
    const endMsg = makeMessage({ content: [textBlock('done')], stop_reason: 'end_turn' });

    // Snapshot the messages at the time of each stream() call (deep clone)
    const snapshotMessages: Array<Anthropic.MessageParam[]> = [];
    const toolUseStream = makeStream(toolUseMsg);
    const endStream = makeStream(endMsg);
    const streams = [toolUseStream, endStream];
    let streamIdx = 0;
    const provider: LlmProvider = {
      stream(params) {
        // Deep-clone the messages at call time
        snapshotMessages.push(JSON.parse(JSON.stringify(params.messages)) as Anthropic.MessageParam[]);
        return streams[streamIdx++]!;
      },
      create: vi.fn(),
    };
    loop.provider = provider;

    await loop.turn('read a file', {});

    // Both stream() calls should have happened
    expect(snapshotMessages).toHaveLength(2);

    // Call 2: last message is the tool_result (array content). Its last block should
    // have a cache_control ephemeral breakpoint set by markMessageHistoryCache().
    const snap2 = snapshotMessages[1]!;
    const lastMsgSnap2 = snap2[snap2.length - 1]!;
    const content = lastMsgSnap2.content;
    expect(Array.isArray(content)).toBe(true);
    if (Array.isArray(content)) {
      const lastBlock = content[content.length - 1]!;
      expect((lastBlock as { cache_control?: { type: string } }).cache_control?.type).toBe('ephemeral');
    }
  });
});

// ── A-6: cacheEligible — only turn 1 ─────────────────────────────────────────

describe('A-6: Response cache eligibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turn-1 end_turn stores to cache; second fresh-conversation loop returns cached content', async () => {
    // Use noCache=false so caching is enabled
    const loop1 = makeLoop({ noCache: false });
    const endMsg = makeMessage({
      content: [textBlock('cached response')],
      stop_reason: 'end_turn',
    });
    const { provider: p1 } = makeProvider([endMsg]);
    loop1.provider = p1;

    const result1 = await loop1.turn('hello world', {});
    expect(result1.content).toBe('cached response');

    // Second fresh loop (same config, different loop instance but same cache key setup)
    const loop2 = makeLoop({ noCache: false });
    // Inject the same response cache from loop1 into loop2 to simulate shared cache
    loop2.responseCache = loop1.responseCache;

    const streamSpy = vi.fn().mockReturnValue(makeStream(endMsg));
    loop2.provider = { stream: streamSpy, create: vi.fn() };

    const result2 = await loop2.turn('hello world', {});
    // Cache hit: stream() should NOT have been called
    expect(streamSpy).not.toHaveBeenCalled();
    expect(result2.usage.inputTokens).toBe(0);
    expect(result2.content).toBe('cached response');
  });

  it('mid-conversation: same message with prior history causes stream() to be called', async () => {
    const loop = makeLoop({ noCache: false });

    const endMsg = makeMessage({
      content: [textBlock('cached response')],
      stop_reason: 'end_turn',
    });
    const { provider, calls } = makeProvider([endMsg, endMsg]);
    loop.provider = provider;

    // First turn — populates cache
    await loop.turn('hello world', {});

    // Second turn with same message — history now has prior messages, so NOT eligible
    await loop.turn('hello world', {});

    // stream() was called for both turns (second is not cached due to mid-conversation)
    expect(calls).toHaveLength(2);
  });
});

// ── A-7: _appendEngramSignalsToHandoff dedup ─────────────────────────────────

describe('A-7: Pending Engram Work deduplication', () => {
  let tmpDir: string;
  let handoffPath: string;
  let loop: ReturnType<typeof makeLoop>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-handoff-test-'));
    handoffPath = path.join(tmpDir, 'HANDOFF.md');
    loop = makeLoop();

    // Override readMarkdownFile/writeMarkdownFile to use real fs on tmpDir
    const { readMarkdownFile, writeMarkdownFile } = vi.mocked(
      await import('../project-memory/store.js'),
    );
    readMarkdownFile.mockImplementation((p: string) => {
      try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
    });
    writeMarkdownFile.mockImplementation((p: string, content: string) => {
      fs.writeFileSync(p, content, 'utf8');
    });

    // Mock readRecentSignals to return 3 'thin-context' signals (triggers threshold)
    const signalsMod = await import('../engram/signals.js');
    vi.mocked(signalsMod.readRecentSignals).mockReturnValue([
      { type: 'thin-context', detail: 'test', ts: new Date().toISOString() },
      { type: 'thin-context', detail: 'test', ts: new Date().toISOString() },
      { type: 'thin-context', detail: 'test', ts: new Date().toISOString() },
    ]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('writes handoff twice and ends with exactly one ## Pending Engram Work section', async () => {
    // Write initial handoff content
    fs.writeFileSync(handoffPath, '## Current State\n\nWorking on feature X.\n', 'utf8');

    // Call _appendEngramSignalsToHandoff twice
    loop._appendEngramSignalsToHandoff(handoffPath);
    loop._appendEngramSignalsToHandoff(handoffPath);

    const content = fs.readFileSync(handoffPath, 'utf8');
    const matches = content.match(/## Pending Engram Work/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it('preserves other sections after deduplication', async () => {
    fs.writeFileSync(
      handoffPath,
      '## Current State\n\nWorking on feature X.\n\n## Another Section\n\nSome notes.\n',
      'utf8',
    );

    loop._appendEngramSignalsToHandoff(handoffPath);
    loop._appendEngramSignalsToHandoff(handoffPath);

    const content = fs.readFileSync(handoffPath, 'utf8');
    expect(content).toContain('## Current State');
    expect(content).toContain('## Another Section');
    expect(content).toContain('Some notes.');

    const pendingMatches = content.match(/## Pending Engram Work/g) ?? [];
    expect(pendingMatches).toHaveLength(1);
  });
});

// ── Lazy conversation creation + auto-titling ────────────────────────────────

describe('Lazy conversation creation and auto-titling', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeEach(async () => {
    db = vi.mocked(await import('../db/index.js'));
    db.createConversation.mockClear();
    db.addConversationTurn.mockClear();
    db.updateConversationTitle.mockClear();
  });

  afterEach(async () => {
    db.getConversationTurns.mockReturnValue([]);
    vi.restoreAllMocks();
  });

  it('creates no conversation row in initialize(); creates one on the first turn', async () => {
    const loop = makeLoop();
    const endMsg = makeMessage({ content: [textBlock('hi')], stop_reason: 'end_turn' });
    const { provider } = makeProvider([endMsg]);
    loop.provider = provider;

    await loop.initialize();
    expect(db.createConversation).not.toHaveBeenCalled();
    expect(loop._conversationId).toBeUndefined();
    expect(loop.getConversationId()).toBeNull();

    await loop.turn('hello', {});
    expect(db.createConversation).toHaveBeenCalledOnce();
    expect(loop._conversationId).toBe('conv-1');
    expect(loop.getConversationId()).toBe('conv-1');
    expect(db.addConversationTurn).toHaveBeenCalledWith('conv-1', 'user', 'hello');
  });

  it('fires title generation once after the first turn completes', async () => {
    db.getConversationTurns.mockReturnValue([
      { role: 'user', content: 'hello' },
    ]);
    const loop = makeLoop();
    const endMsg = makeMessage({ content: [textBlock('hi')], stop_reason: 'end_turn' });
    const { provider } = makeProvider([endMsg, endMsg]);
    provider.create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Greeting Conversation' }],
    } as unknown as Anthropic.Message);
    loop.provider = provider;

    await loop.turn('hello', {});
    expect(loop._titleGeneration).toBeDefined();
    await loop._titleGeneration;
    expect(db.updateConversationTitle).toHaveBeenCalledWith('conv-1', 'Greeting Conversation');

    // Second turn must not start another generation
    await loop.turn('hello again', {});
    expect(provider.create).toHaveBeenCalledOnce();
  });

  it('does not fire title generation without an apiKey', async () => {
    const loop = makeLoop({ apiKey: '' });
    const endMsg = makeMessage({ content: [textBlock('hi')], stop_reason: 'end_turn' });
    const { provider } = makeProvider([endMsg]);
    loop.provider = provider;

    await loop.turn('hello', {});
    expect(loop._titleGeneration).toBeUndefined();
  });
});
