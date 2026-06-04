import { spawn as nodeSpawn } from 'child_process';
import nodeFs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { ChildProcess } from 'child_process';
import type { SandboxRunner, ExecOpts, ExecResult } from './runner.js';
import { LocalRunner, UnsupportedLanguageError } from './local.js';
import type { SpawnFn, FsAdapter } from './local.js';

const LANGUAGE_CONFIG: Record<string, { ext: string; image: string; interpreter: string }> = {
  javascript: { ext: '.js',  image: 'node:22-alpine',    interpreter: 'node' },
  python:     { ext: '.py',  image: 'python:3.12-alpine', interpreter: 'python3' },
  bash:       { ext: '.sh',  image: 'bash:5',            interpreter: 'bash' },
};

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

function truncate(output: string, maxBytes: number): string {
  const buf = Buffer.from(output, 'utf8');
  if (buf.length <= maxBytes) return output;
  return buf.slice(0, maxBytes).toString('utf8') + '\n[truncated]';
}

export class DockerRunner implements SandboxRunner {
  private readonly fallback: LocalRunner;
  private readonly spawnFn: SpawnFn;
  private readonly fs: FsAdapter;

  constructor(fallback: LocalRunner, spawnFn?: SpawnFn, fsAdapter?: FsAdapter) {
    this.fallback = fallback;
    this.spawnFn = spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    this.fs = fsAdapter ?? nodeFs;
  }

  static isAvailable(spawnFn?: SpawnFn): Promise<boolean> {
    const doSpawn: SpawnFn = spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    return new Promise<boolean>((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, 3_000);

      const child = doSpawn('docker', ['info'], {
        stdio: 'ignore',
        signal: controller.signal,
      }) as ChildProcess;

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });

      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
    });
  }

  async exec(code: string, language: string, opts?: ExecOpts): Promise<ExecResult> {
    const cfg = LANGUAGE_CONFIG[language];
    if (!cfg) throw new UnsupportedLanguageError(language);

    const available = await DockerRunner.isAvailable(this.spawnFn);
    if (!available) {
      return this.fallback.exec(code, language, opts);
    }

    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const memoryMb = opts?.memoryMb ?? 128;
    const id = crypto.randomBytes(8).toString('hex');
    const tmpDir = path.join(os.tmpdir(), `koa-docker-${id}`);
    const tmpFile = path.join(tmpDir, `code${cfg.ext}`);

    await this.fs.mkdir?.(tmpDir, { recursive: true });
    await this.fs.writeFile(tmpFile, code, 'utf8');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await new Promise<ExecResult>((resolve) => {
        const args = [
          'run', '--rm',
          '--network=none',
          `--memory=${memoryMb}m`,
          '--cpus=0.5',
          '--read-only',
          '-v', `${tmpDir}:/code:ro`,
          cfg.image,
          cfg.interpreter,
          `/code/code${cfg.ext}`,
        ];

        const child = this.spawnFn('docker', args, {
          signal: controller.signal,
        }) as ChildProcess;

        let stdoutBuf = '';
        let stderrBuf = '';

        child.stdout?.on('data', (chunk: Buffer) => {
          stdoutBuf += chunk.toString('utf8');
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderrBuf += chunk.toString('utf8');
        });

        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({
            stdout: truncate(stdoutBuf, MAX_OUTPUT_BYTES),
            stderr: truncate(stderrBuf, MAX_OUTPUT_BYTES),
            exitCode: code ?? 1,
            timedOut,
          });
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          if (err.name === 'AbortError') {
            resolve({
              stdout: truncate(stdoutBuf, MAX_OUTPUT_BYTES),
              stderr: truncate(stderrBuf, MAX_OUTPUT_BYTES),
              exitCode: 1,
              timedOut: true,
            });
          } else {
            resolve({
              stdout: '',
              stderr: err.message,
              exitCode: 1,
              timedOut: false,
            });
          }
        });
      });
    } finally {
      clearTimeout(timer);
      await this.fs.rm?.(tmpDir, { recursive: true, force: true }).catch(() => { /* best-effort cleanup */ });
    }
  }
}
