import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ClaudeCodeProvider } from '../agent/providers/claude_code.js';

// ── mock child_process.spawn ──────────────────────────────────────────────────

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = spawn as ReturnType<typeof vi.fn>;

function makeProc(exitCode: number, stdout: string, stderr = '') {
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();
  const stdinEmitter = new EventEmitter() as EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdinEmitter.write = vi.fn();
  stdinEmitter.end = vi.fn();

  const proc = new EventEmitter() as EventEmitter & {
    stdout: typeof stdoutEmitter;
    stderr: typeof stderrEmitter;
    stdin: typeof stdinEmitter;
  };
  proc.stdout = stdoutEmitter;
  proc.stderr = stderrEmitter;
  proc.stdin = stdinEmitter;

  // Emit data + close asynchronously
  setImmediate(() => {
    stdoutEmitter.emit('data', Buffer.from(stdout));
    stderrEmitter.emit('data', Buffer.from(stderr));
    proc.emit('close', exitCode);
  });

  return proc;
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── ClaudeCodeProvider.create ─────────────────────────────────────────────────

describe('ClaudeCodeProvider.create', () => {
  const params = {
    model: 'claude-code',
    max_tokens: 1024,
    system: [{ type: 'text' as const, text: 'You are koa.' }],
    messages: [{ role: 'user' as const, content: 'What is 2+2?' }],
  };

  it('returns an Anthropic.Message with the result text', async () => {
    const resultJson = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '4', usage: { input_tokens: 5, output_tokens: 3 } });
    mockSpawn.mockReturnValue(makeProc(0, resultJson));

    const provider = new ClaudeCodeProvider('claude');
    const msg = await provider.create(params);

    expect(msg.role).toBe('assistant');
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.content[0]).toMatchObject({ type: 'text', text: '4' });
    expect(msg.usage.input_tokens).toBe(5);
    expect(msg.usage.output_tokens).toBe(3);
  });

  it('rejects when claude exits non-zero', async () => {
    mockSpawn.mockReturnValue(makeProc(1, '', 'some error'));
    const provider = new ClaudeCodeProvider('claude');
    await expect(provider.create(params)).rejects.toThrow('claude exited 1');
  });

  it('rejects when response has is_error=true', async () => {
    const errJson = JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'rate limited' });
    mockSpawn.mockReturnValue(makeProc(0, errJson));
    const provider = new ClaudeCodeProvider('claude');
    await expect(provider.create(params)).rejects.toThrow('rate limited');
  });

  it('falls back to raw stdout if JSON parse fails', async () => {
    mockSpawn.mockReturnValue(makeProc(0, 'not json'));
    const provider = new ClaudeCodeProvider('claude');
    const msg = await provider.create(params);
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'not json' });
  });

  it('passes --dangerously-skip-permissions when skipPermissions=true', async () => {
    const resultJson = JSON.stringify({ type: 'result', is_error: false, result: 'ok' });
    mockSpawn.mockReturnValue(makeProc(0, resultJson));

    const provider = new ClaudeCodeProvider('claude', true);
    await provider.create(params);

    const args = mockSpawn.mock.calls[0]?.[1] as string[];
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('sends the system prompt and user message to stdin', async () => {
    const resultJson = JSON.stringify({ type: 'result', is_error: false, result: 'ok' });
    const proc = makeProc(0, resultJson);
    mockSpawn.mockReturnValue(proc);

    const provider = new ClaudeCodeProvider('claude');
    await provider.create(params);

    expect(proc.stdin.write).toHaveBeenCalledWith('System:\nYou are koa.\n\nUser:\nWhat is 2+2?');
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it('serializes the full conversation history, not just the last message', async () => {
    const resultJson = JSON.stringify({ type: 'result', is_error: false, result: 'ok' });
    const proc = makeProc(0, resultJson);
    mockSpawn.mockReturnValue(proc);

    const provider = new ClaudeCodeProvider('claude');
    await provider.create({
      model: 'claude-code',
      max_tokens: 1024,
      system: [{ type: 'text' as const, text: 'You are koa.' }],
      messages: [
        { role: 'user' as const, content: 'What is 2+2?' },
        { role: 'assistant' as const, content: [{ type: 'text' as const, text: '4' }] },
        { role: 'user' as const, content: 'Double it.' },
      ],
    });

    expect(proc.stdin.write).toHaveBeenCalledWith(
      'System:\nYou are koa.\n\nUser:\nWhat is 2+2?\n\nAssistant:\n4\n\nUser:\nDouble it.',
    );
  });
});

// ── ClaudeCodeProvider.stream ─────────────────────────────────────────────────

describe('ClaudeCodeProvider.stream', () => {
  it('emits text event and resolves finalMessage', async () => {
    const resultJson = JSON.stringify({ type: 'result', is_error: false, result: 'hello' });
    mockSpawn.mockReturnValue(makeProc(0, resultJson));

    const provider = new ClaudeCodeProvider('claude');
    const params = {
      model: 'claude-code',
      max_tokens: 1024,
      system: [],
      messages: [{ role: 'user' as const, content: 'say hello' }],
    };

    const stream = provider.stream(params);
    const textParts: string[] = [];
    stream.on('text', (t) => textParts.push(t));

    const msg = await stream.finalMessage();
    expect(textParts).toEqual(['hello']);
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'hello' });
  });
});
