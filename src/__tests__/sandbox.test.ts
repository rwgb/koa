import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ChildProcess } from 'child_process';
import { LocalRunner, UnsupportedLanguageError } from '../sandbox/local.js';
import { DockerRunner } from '../sandbox/docker.js';
import { createExecuteCodeTool } from '../agent/tools/execute_code.js';
import type { SandboxRunner } from '../sandbox/runner.js';
import type { SpawnFn, FsAdapter } from '../sandbox/local.js';
import type { KoaConfig } from '../config/index.js';

// Minimal config for tool tests
const minimalConfig = {
  sandboxBackend: 'local' as const,
  sandboxTimeoutMs: 10_000,
} as KoaConfig;

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FakeProcessHandle {
  proc: ChildProcess;
  emitStdout(data: string): void;
  emitStderr(data: string): void;
  emitClose(code: number | null): void;
  emitError(err: Error): void;
}

function makeFakeProcess(): FakeProcessHandle {
  let closeHandler: ((code: number | null) => void) | undefined;
  let errorHandler: ((err: Error) => void) | undefined;
  let stdoutDataHandler: ((chunk: Buffer) => void) | undefined;
  let stderrDataHandler: ((chunk: Buffer) => void) | undefined;

  const proc = {
    stdout: {
      on(event: string, fn: (chunk: Buffer) => void) {
        if (event === 'data') stdoutDataHandler = fn;
      },
    },
    stderr: {
      on(event: string, fn: (chunk: Buffer) => void) {
        if (event === 'data') stderrDataHandler = fn;
      },
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      if (event === 'close') closeHandler = fn as (code: number | null) => void;
      if (event === 'error') errorHandler = fn as (err: Error) => void;
    },
  } as unknown as ChildProcess;

  return {
    proc,
    emitStdout(data: string) { stdoutDataHandler?.(Buffer.from(data)); },
    emitStderr(data: string) { stderrDataHandler?.(Buffer.from(data)); },
    emitClose(code: number | null) { closeHandler?.(code); },
    emitError(err: Error) { errorHandler?.(err); },
  };
}

function makeFsAdapter(): FsAdapter & {
  writeMock: Mock;
  unlinkMock: Mock;
  mkdirMock: Mock;
  rmMock: Mock;
} {
  const writeMock = vi.fn().mockResolvedValue(undefined);
  const unlinkMock = vi.fn().mockResolvedValue(undefined);
  const mkdirMock = vi.fn().mockResolvedValue(undefined);
  const rmMock = vi.fn().mockResolvedValue(undefined);
  return {
    writeFile: writeMock as unknown as FsAdapter['writeFile'],
    unlink: unlinkMock,
    mkdir: mkdirMock,
    rm: rmMock,
    writeMock,
    unlinkMock,
    mkdirMock,
    rmMock,
  };
}

/**
 * Yield to the microtask queue so async setup inside `exec` (writeFile await)
 * completes and the spawn function is called with handlers registered.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ── LocalRunner tests ─────────────────────────────────────────────────────────

describe('LocalRunner', () => {
  let spawnMock: Mock;
  let fsAdapter: ReturnType<typeof makeFsAdapter>;
  let runner: LocalRunner;

  beforeEach(() => {
    spawnMock = vi.fn();
    fsAdapter = makeFsAdapter();
    runner = new LocalRunner(spawnMock as unknown as SpawnFn, fsAdapter);
  });

  it('executes JavaScript and returns stdout', async () => {
    const { proc, emitStdout, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('console.log("hi")', 'javascript');
    await flushMicrotasks(); // wait for writeFile then spawnFn

    emitStdout('hi\n');
    emitClose(0);

    const result = await promise;
    expect(result.stdout).toBe('hi\n');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(spawnMock).toHaveBeenCalledWith(
      'node',
      expect.arrayContaining([expect.stringMatching(/koa-sandbox-.*\.js$/)]),
      expect.any(Object),
    );
  });

  it('executes Python and returns stdout', async () => {
    const { proc, emitStdout, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('print("hello")', 'python');
    await flushMicrotasks();

    emitStdout('hello\n');
    emitClose(0);

    const result = await promise;
    expect(result.stdout).toBe('hello\n');
    expect(spawnMock).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining([expect.stringMatching(/\.py$/)]),
      expect.any(Object),
    );
  });

  it('executes Bash and returns stdout', async () => {
    const { proc, emitStdout, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('echo "test"', 'bash');
    await flushMicrotasks();

    emitStdout('test\n');
    emitClose(0);

    const result = await promise;
    expect(result.stdout).toBe('test\n');
    expect(spawnMock).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining([expect.stringMatching(/\.sh$/)]),
      expect.any(Object),
    );
  });

  it('captures stderr and non-zero exit code', async () => {
    const { proc, emitStderr, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('process.exit(1)', 'javascript');
    await flushMicrotasks();

    emitStderr('some error\n');
    emitClose(1);

    const result = await promise;
    expect(result.stderr).toBe('some error\n');
    expect(result.exitCode).toBe(1);
  });

  it('fires timedOut=true when AbortError is received', async () => {
    const { proc, emitError } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('sleep 100', 'bash', { timeoutMs: 50 });
    await flushMicrotasks();

    // Simulate AbortController firing the error event on the child process
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    emitError(abortErr);

    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('truncates stdout at 50 KB', async () => {
    const { proc, emitStdout, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const bigOutput = 'x'.repeat(60 * 1024);
    const promise = runner.exec('...', 'javascript');
    await flushMicrotasks();

    emitStdout(bigOutput);
    emitClose(0);

    const result = await promise;
    expect(result.stdout.endsWith('[truncated]')).toBe(true);
    expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(50 * 1024 + 50);
  });

  it('truncates stderr at 50 KB', async () => {
    const { proc, emitStderr, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const bigErr = 'e'.repeat(60 * 1024);
    const promise = runner.exec('...', 'javascript');
    await flushMicrotasks();

    emitStderr(bigErr);
    emitClose(0);

    const result = await promise;
    expect(result.stderr.endsWith('[truncated]')).toBe(true);
  });

  it('cleans up temp file on success', async () => {
    const { proc, emitClose } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('x', 'javascript');
    await flushMicrotasks();

    emitClose(0);
    await promise;

    expect(fsAdapter.unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('cleans up temp file on spawn error', async () => {
    const { proc, emitError } = makeFakeProcess();
    spawnMock.mockReturnValue(proc);

    const promise = runner.exec('x', 'javascript');
    await flushMicrotasks();

    emitError(new Error('spawn failed'));
    await promise;

    expect(fsAdapter.unlinkMock).toHaveBeenCalledTimes(1);
  });

  it('throws UnsupportedLanguageError for unknown language', async () => {
    await expect(runner.exec('x', 'ruby')).rejects.toThrow(UnsupportedLanguageError);
    await expect(runner.exec('x', 'ruby')).rejects.toThrow(/ruby/);
  });
});

// ── DockerRunner tests ─────────────────────────────────────────────────────────

describe('DockerRunner', () => {
  let spawnMock: Mock;
  let fsAdapter: ReturnType<typeof makeFsAdapter>;
  let localRunner: LocalRunner;
  let dockerRunner: DockerRunner;

  beforeEach(() => {
    spawnMock = vi.fn();
    fsAdapter = makeFsAdapter();
    // Local runner also uses the same spawnMock so we can detect fallback calls
    localRunner = new LocalRunner(spawnMock as unknown as SpawnFn, fsAdapter);
    dockerRunner = new DockerRunner(localRunner, spawnMock as unknown as SpawnFn, fsAdapter);
  });

  it('passes correct docker flags when Docker is available', async () => {
    // Call 1: docker info (isAvailable) → exit 0
    const infoFake = makeFakeProcess();
    // Call 2: docker run → execution result
    const runFake = makeFakeProcess();

    spawnMock
      .mockReturnValueOnce(infoFake.proc)  // docker info
      .mockReturnValueOnce(runFake.proc);  // docker run

    const promise = dockerRunner.exec('print("hi")', 'python');

    // Flush writeFile (mkdir + writeFile), then isAvailable check triggers spawn
    await flushMicrotasks();

    // Resolve the isAvailable spawn (docker info close)
    infoFake.emitClose(0);

    // Yield so isAvailable promise resolves and docker run spawn fires
    await flushMicrotasks();

    // Resolve the docker run
    runFake.emitStdout('hi\n');
    runFake.emitClose(0);

    await promise;

    const runCall = spawnMock.mock.calls[1] as [string, string[]];
    expect(runCall[0]).toBe('docker');
    const args: string[] = runCall[1];
    expect(args).toContain('--network=none');
    expect(args).toContain('--read-only');
    expect(args.some((a) => a.startsWith('--memory='))).toBe(true);
    expect(args.some((a) => a.startsWith('--cpus='))).toBe(true);
    expect(args).toContain('python:3.12-alpine');
    expect(args).toContain('python3');
  });

  it('falls back to LocalRunner when Docker is unavailable', async () => {
    // docker info fails → exit 1
    const infoFake = makeFakeProcess();
    // local python3 execution
    const localFake = makeFakeProcess();

    spawnMock
      .mockReturnValueOnce(infoFake.proc)   // docker info
      .mockReturnValueOnce(localFake.proc); // fallback spawn

    const promise = dockerRunner.exec('print("hi")', 'python');

    await flushMicrotasks();

    // Docker is unavailable
    infoFake.emitClose(1);

    // Yield so fallback path proceeds (writeFile, then spawn)
    await flushMicrotasks();

    localFake.emitStdout('hi\n');
    localFake.emitClose(0);

    const result = await promise;
    expect(result.stdout).toBe('hi\n');

    // Confirm fallback spawned python3 rather than docker
    const fallbackCall = spawnMock.mock.calls[1] as [string, string[]];
    expect(fallbackCall[0]).toBe('python3');
  });
});

// ── execute_code tool tests ───────────────────────────────────────────────────

describe('execute_code tool', () => {
  let mockRunner: SandboxRunner;
  let tool: ReturnType<typeof createExecuteCodeTool>;

  beforeEach(() => {
    mockRunner = {
      exec: vi.fn().mockResolvedValue({
        stdout: 'hello\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
      }),
    };
    tool = createExecuteCodeTool(mockRunner, minimalConfig);
  });

  it('rejects blank code', async () => {
    const result = await tool.execute({ language: 'javascript', code: '   ' });
    expect(result).toContain('Error');
    expect(result).toContain('blank');
    expect(mockRunner.exec).not.toHaveBeenCalled();
  });

  it('rejects unsupported language before exec', async () => {
    const result = await tool.execute({ language: 'ruby', code: 'puts "hi"' });
    expect(result).toContain('Error');
    expect(result).toContain('ruby');
    expect(mockRunner.exec).not.toHaveBeenCalled();
  });

  it('formats successful output with exit_code and stdout', async () => {
    const result = (await tool.execute({
      language: 'javascript',
      code: 'console.log("hi")',
    })) as string;
    expect(result).toContain('exit_code: 0');
    expect(result).toContain('timed_out: false');
    expect(result).toContain('hello\n');
    expect(result).toContain('--- stdout ---');
  });

  it('includes stderr section when stderr is non-empty', async () => {
    (mockRunner.exec as Mock).mockResolvedValue({
      stdout: '',
      stderr: 'traceback\n',
      exitCode: 1,
      timedOut: false,
    });
    const result = (await tool.execute({ language: 'python', code: 'x' })) as string;
    expect(result).toContain('--- stderr ---');
    expect(result).toContain('traceback\n');
    expect(result).toContain('exit_code: 1');
  });

  it('shows (no output) when both stdout and stderr are empty', async () => {
    (mockRunner.exec as Mock).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    });
    const result = (await tool.execute({ language: 'bash', code: 'true' })) as string;
    expect(result).toContain('(no output)');
  });

  it('reports timed_out: true in output', async () => {
    (mockRunner.exec as Mock).mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 1,
      timedOut: true,
    });
    const result = (await tool.execute({
      language: 'bash',
      code: 'sleep 100',
    })) as string;
    expect(result).toContain('timed_out: true');
  });

  it('passes configured timeoutMs to runner', async () => {
    const configWithTimeout = { ...minimalConfig, sandboxTimeoutMs: 5000 };
    const t = createExecuteCodeTool(mockRunner, configWithTimeout);
    await t.execute({ language: 'javascript', code: '1+1' });
    expect(mockRunner.exec).toHaveBeenCalledWith('1+1', 'javascript', { timeoutMs: 5000 });
  });
});
