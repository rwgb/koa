import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';

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
}));

function makeConfig(overrides: Partial<KoaConfig> = {}): KoaConfig {
  return {
    model: 'claude-sonnet-4-6',
    maxTokens: 8096,
    projectPath: '/tmp/test-project',
    engramEnabled: false,
    apiKey: 'sk-test',
    smartRouting: false,
    maxToolOutputChars: 12000,
    compactAfterTurns: 10,
    autoCheckpointTurns: 5,
    autoCheckpointMinutes: 15,
    noCache: false,
    autoChaining: false,
    briefingEnabled: false,
    briefingTime: '08:00',
    ttsProvider: 'say',
    elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
    elevenLabsModel: 'eleven_turbo_v2_5',
    provider: 'anthropic' as const,
    ollamaModel: 'llama3.2',
    ollamaBaseUrl: 'http://localhost:11434',
    sandboxBackend: 'local' as const,
    sandboxTimeoutMs: 10000,
    browserEnabled: false,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeLoop(configOverrides: Partial<KoaConfig> = {}): any {
  const config = makeConfig(configOverrides);
  const registry = { toAnthropicTools: vi.fn().mockReturnValue([]), get: vi.fn(), register: vi.fn() };
  const engram = {
    sync: vi.fn().mockResolvedValue(undefined),
    getContext: vi.fn().mockResolvedValue({ hotFiles: [], masterFiles: [] }),
    startSession: vi.fn().mockResolvedValue(undefined),
    autoIndex: vi.fn().mockResolvedValue(undefined),
    buildSystemPromptInjection: vi.fn().mockReturnValue(''),
    rememberSession: vi.fn().mockResolvedValue(undefined),
  };
  const usage = {
    addTurn: vi.fn(),
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

describe('_autoCheckpoint() guards', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loop: any;

  beforeEach(() => {
    loop = makeLoop();
  });

  it('does not call checkpoint() when turnCount is 0', () => {
    const spy = vi.spyOn(loop, 'checkpoint').mockResolvedValue(undefined);
    loop._autoCheckpoint();
    expect(spy).not.toHaveBeenCalled();
  });

  it('calls checkpoint() when turnCount > 0', () => {
    const spy = vi.spyOn(loop, 'checkpoint').mockResolvedValue(undefined);
    loop.state.turnCount = 1;
    loop._autoCheckpoint();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('skips a second call while first is in progress', async () => {
    let resolveFirst!: () => void;
    const firstPromise = new Promise<void>((res) => { resolveFirst = res; });
    const spy = vi.spyOn(loop, 'checkpoint').mockReturnValue(firstPromise);
    loop.state.turnCount = 1;

    loop._autoCheckpoint();
    loop._autoCheckpoint();

    expect(spy).toHaveBeenCalledOnce();
    resolveFirst();
    await firstPromise;
  });

  it('resets _checkpointInProgress to false after failure', async () => {
    vi.spyOn(loop, 'checkpoint').mockRejectedValue(new Error('api down'));
    loop.state.turnCount = 1;
    loop._autoCheckpoint();
    await vi.waitFor(() => {
      expect(loop._checkpointInProgress).toBe(false);
    });
  });
});

describe('_autoCheckpoint() stderr logging', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loop: any;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    loop = makeLoop();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    loop.state.turnCount = 3;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('writes starting message synchronously', () => {
    vi.spyOn(loop, 'checkpoint').mockResolvedValue(undefined);
    loop._autoCheckpoint();
    expect(stderrSpy).toHaveBeenCalledWith('[Koa] auto-checkpoint starting (turn 3)\n');
  });

  it('writes complete message after success', async () => {
    vi.spyOn(loop, 'checkpoint').mockResolvedValue(undefined);
    loop._autoCheckpoint();
    await vi.waitFor(() => {
      expect(stderrSpy).toHaveBeenCalledWith('[Koa] auto-checkpoint complete\n');
    });
  });

  it('writes failed message on error', async () => {
    vi.spyOn(loop, 'checkpoint').mockRejectedValue(new Error('boom'));
    loop._autoCheckpoint();
    await vi.waitFor(() => {
      expect(stderrSpy).toHaveBeenCalledWith('[Koa] auto-checkpoint failed: boom\n');
    });
  });
});

describe('turn-based trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires _autoCheckpoint at each multiple of autoCheckpointTurns', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 3, autoCheckpointMinutes: 0 });
    const spy = vi.spyOn(loop, '_autoCheckpoint');

    // Simulate turn() calling _autoCheckpoint at multiples of 3
    loop.state.turnCount = 3;
    if (loop.config.autoCheckpointTurns > 0 && loop.state.turnCount % loop.config.autoCheckpointTurns === 0) {
      loop._autoCheckpoint();
    }
    loop.state.turnCount = 6;
    if (loop.config.autoCheckpointTurns > 0 && loop.state.turnCount % loop.config.autoCheckpointTurns === 0) {
      loop._autoCheckpoint();
    }
    loop.state.turnCount = 7;
    if (loop.config.autoCheckpointTurns > 0 && loop.state.turnCount % loop.config.autoCheckpointTurns === 0) {
      loop._autoCheckpoint();
    }

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not fire when autoCheckpointTurns is 0', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 0 });
    const spy = vi.spyOn(loop, '_autoCheckpoint');
    loop.state.turnCount = 5;

    if (loop.config.autoCheckpointTurns > 0 && loop.state.turnCount % loop.config.autoCheckpointTurns === 0) {
      loop._autoCheckpoint();
    }

    expect(spy).not.toHaveBeenCalled();
  });
});

describe('time-based trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers an interval when autoCheckpointMinutes > 0', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 1 });
    await loop.initialize();
    expect(loop._checkpointTimer).toBeDefined();
  });

  it('does not register an interval when autoCheckpointMinutes is 0', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 0 });
    await loop.initialize();
    expect(loop._checkpointTimer).toBeUndefined();
  });

  it('fires checkpoint after the configured interval elapses', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 1 });
    const spy = vi.spyOn(loop, 'checkpoint').mockResolvedValue(undefined);
    await loop.initialize();
    loop.state.turnCount = 2;

    vi.advanceTimersByTime(60_000);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does not fire before the interval elapses', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 1 });
    const spy = vi.spyOn(loop, 'checkpoint').mockResolvedValue(undefined);
    await loop.initialize();
    loop.state.turnCount = 2;

    vi.advanceTimersByTime(59_999);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('finalize() clears the timer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears _checkpointTimer after finalize', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 1 });
    await loop.initialize();
    expect(loop._checkpointTimer).toBeDefined();
    await loop.finalize();
    expect(loop._checkpointTimer).toBeUndefined();
  });

  it('clears the timer even when turnCount is 0', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loop: any = makeLoop({ autoCheckpointTurns: 0, autoCheckpointMinutes: 1 });
    await loop.initialize();
    // turnCount stays 0 — finalize() early-returns but must still clear the timer
    await loop.finalize();
    expect(loop._checkpointTimer).toBeUndefined();
  });
});
