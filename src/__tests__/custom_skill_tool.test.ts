import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// vi.hoisted runs before any imports and before vi.mock factories, so the
// spawnMock reference is initialised by the time vi.mock('child_process') fires.
const spawnMock = vi.hoisted(() => vi.fn());

// --- child_process mock ---
vi.mock('child_process', () => ({ spawn: spawnMock }));

// --- ssrf mock ---
// validateSafeUrl is async from C-2; mock it so HTTP tests don't make real
// DNS calls or HTTPS checks.
vi.mock('../../utils/ssrf.js', () => ({
  validateSafeUrl: vi.fn().mockResolvedValue(undefined),
}));

import { createCustomSkillTool } from '../agent/tools/custom_skill_tool.js';
import type { CustomSkillDef } from '../skills/store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal bash skill definition. */
function bashSkill(command: string): CustomSkillDef {
  return {
    name: 'test_bash',
    description: 'test',
    type: 'bash',
    config: { command },
    createdAt: new Date().toISOString(),
  };
}

/** Build a minimal http skill definition. */
function httpSkill(url: string, method = 'GET'): CustomSkillDef {
  return {
    name: 'test_http',
    description: 'test',
    type: 'http',
    config: { url, method },
    createdAt: new Date().toISOString(),
  };
}

type FakeChild = EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; stdin: null };

/**
 * Installs a one-shot spawnMock that returns a fake child process which emits
 * `stdoutData` then exits with code 0. The captured argv elements (everything
 * after the binary) are written into `capturedArgs`.
 */
function makeFakeChild(capturedArgs: string[], stdoutData = 'ok'): void {
  const child: FakeChild = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: null,
  });

  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(stdoutData));
    child.emit('close', 0);
  });

  spawnMock.mockImplementationOnce((_bin: string, args: string[]) => {
    capturedArgs.push(...args);
    return child;
  });
}

// ---------------------------------------------------------------------------
// Bash branch tests
// ---------------------------------------------------------------------------

describe('createCustomSkillTool — bash branch', () => {
  beforeEach(() => {
    spawnMock.mockClear();
  });

  it('passes a value containing spaces + shell metacharacters as a single argv element', async () => {
    // "hello world; rm -rf /" must arrive as ONE argument to the process,
    // not re-tokenised after substitution.
    const capturedArgs: string[] = [];
    makeFakeChild(capturedArgs);

    const tool = createCustomSkillTool(bashSkill('echo {{input.msg}}'));
    await tool.execute({ input: { msg: 'hello world; rm -rf /' } });

    expect(spawnMock).toHaveBeenCalledOnce();
    // spawnArgs is everything after the binary; the single substituted value
    // must be exactly one element.
    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]).toBe('hello world; rm -rf /');
  });

  it('returns an error when a {{input.key}} value starts with "-"', async () => {
    const tool = createCustomSkillTool(bashSkill('echo {{input.msg}}'));
    const result = await tool.execute({ input: { msg: '-rf' } }) as string;

    expect(result).toContain('may not start with "-"');
    // spawn must NOT have been called — we reject before execution.
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('allows {{flag:input.key}} to pass a value starting with "-" as a single arg', async () => {
    const capturedArgs: string[] = [];
    makeFakeChild(capturedArgs, 'file1.ts');

    const tool = createCustomSkillTool(bashSkill('ls {{flag:input.opt}}'));
    await tool.execute({ input: { opt: '-la' } });

    expect(spawnMock).toHaveBeenCalledOnce();
    // The flag value must be the sole spawnArg — not split further.
    expect(capturedArgs).toEqual(['-la']);
  });

  it('returns an error when a placeholder is embedded mid-token', async () => {
    const tool = createCustomSkillTool(bashSkill('--arg={{input.val}}'));
    const result = await tool.execute({ input: { val: 'foo' } }) as string;

    expect(result).toContain('placeholder must be a standalone argument');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('returns an error for an empty command template', async () => {
    const tool = createCustomSkillTool(bashSkill(''));
    const result = await tool.execute({}) as string;
    expect(result).toContain('command template is empty');
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HTTP branch tests
// ---------------------------------------------------------------------------

describe('createCustomSkillTool — http branch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('truncates a response body larger than HTTP_MAX_BYTES (50 000 bytes)', async () => {
    // Build a ReadableStream whose single chunk exceeds the cap.
    const oversizedBody = 'x'.repeat(60_000);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(oversizedBody);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const mockResponse = {
      status: 200,
      body: stream,
    } as unknown as Response;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockResponse));

    const tool = createCustomSkillTool(httpSkill('https://example.com/data'));
    const result = await tool.execute({}) as string;

    expect(result.startsWith('HTTP 200\n')).toBe(true);
    // The returned body must be capped at HTTP_MAX_BYTES (50 000) chars.
    const body = result.slice('HTTP 200\n'.length);
    expect(body.length).toBeLessThanOrEqual(50_000);
    expect(body.length).toBeLessThan(oversizedBody.length);
  });

  it('returns a timeout error when the endpoint hangs', async () => {
    // Simulate a hanging endpoint: fetch receives the AbortSignal and rejects
    // with an AbortError the moment the signal fires. We immediately call
    // abort() on the controller that fetch receives, skipping the real 20-second
    // wait but exercising exactly the same code path the real timer triggers.
    const abortError = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });

    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = opts.signal;
        if (signal) {
          // Reject immediately when the signal fires (same path as real timeout).
          signal.addEventListener('abort', () => reject(abortError));
          // Manually abort right away to simulate elapsed timeout without waiting.
          (signal as AbortSignal & { _controller?: AbortController });
        }
        // Drive the abort: the real code does setTimeout(() => controller.abort(), timeout).
        // We replicate that here by aborting on the next microtask so the Promise
        // constructor has returned and listeners are attached.
        Promise.resolve().then(() => {
          if (signal && !signal.aborted) {
            // Trigger abort by dispatching the event directly on the signal.
            const ev = new Event('abort');
            signal.dispatchEvent(ev);
          }
        });
      });
    }));

    const tool = createCustomSkillTool(httpSkill('https://example.com/slow'));
    const result = await tool.execute({}) as string;

    expect(result).toContain('timed out');
  });
});
