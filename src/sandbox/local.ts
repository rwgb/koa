import { spawn as nodeSpawn } from 'child_process';
import nodeFs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { ChildProcess } from 'child_process';
import type { SandboxRunner, ExecOpts, ExecResult } from './runner.js';

export class UnsupportedLanguageError extends Error {
  constructor(language: string) {
    super(`Unsupported language: "${language}". Supported: javascript, python, bash`);
    this.name = 'UnsupportedLanguageError';
  }
}

const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB

const LANGUAGE_CONFIG: Record<string, { ext: string; cmd: string; args: string[] }> = {
  javascript: { ext: '.js', cmd: 'node', args: [] },
  python:     { ext: '.py', cmd: 'python3', args: [] },
  bash:       { ext: '.sh', cmd: 'bash', args: [] },
};

function truncate(output: string, maxBytes: number): string {
  const buf = Buffer.from(output, 'utf8');
  if (buf.length <= maxBytes) return output;
  return buf.slice(0, maxBytes).toString('utf8') + '\n[truncated]';
}

// Injectable interfaces for testability
export interface SpawnFn {
  (cmd: string, args: string[], opts: object): ChildProcess;
}

export interface FsAdapter {
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
  unlink(path: string): Promise<void>;
  mkdir?(path: string, opts: object): Promise<void | string>;
  rm?(path: string, opts: object): Promise<void>;
}

export class LocalRunner implements SandboxRunner {
  private readonly spawnFn: SpawnFn;
  private readonly fs: FsAdapter;

  constructor(spawnFn?: SpawnFn, fsAdapter?: FsAdapter) {
    this.spawnFn = spawnFn ?? (nodeSpawn as unknown as SpawnFn);
    this.fs = fsAdapter ?? nodeFs;
  }

  async exec(code: string, language: string, opts?: ExecOpts): Promise<ExecResult> {
    const cfg = LANGUAGE_CONFIG[language];
    if (!cfg) throw new UnsupportedLanguageError(language);

    const timeoutMs = opts?.timeoutMs ?? 10_000;
    const id = crypto.randomBytes(8).toString('hex');
    const tmpFile = path.join(os.tmpdir(), `koa-sandbox-${id}${cfg.ext}`);

    await this.fs.writeFile(tmpFile, code, 'utf8');

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const SAFE_ENV_KEYS = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TERM']);
      const safeEnv: Record<string, string> = {};
      for (const key of SAFE_ENV_KEYS) {
        if (process.env[key] !== undefined) safeEnv[key] = process.env[key]!;
      }
      const childEnv = { ...safeEnv, ...(opts?.env ?? {}) };

      return await new Promise<ExecResult>((resolve) => {
        const child = this.spawnFn(cfg.cmd, [...cfg.args, tmpFile], {
          env: childEnv,
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

        child.on('close', (code, signal) => {
          clearTimeout(timer);
          resolve({
            stdout: truncate(stdoutBuf, MAX_OUTPUT_BYTES),
            stderr: truncate(stderrBuf, MAX_OUTPUT_BYTES),
            exitCode: code ?? (signal ? 1 : 0),
            timedOut,
          });
        });

        child.on('error', (err) => {
          clearTimeout(timer);
          // AbortController fires an 'error' event with name 'AbortError'
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
      await this.fs.unlink(tmpFile).catch(() => { /* best-effort cleanup */ });
    }
  }
}
