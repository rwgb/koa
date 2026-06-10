export interface ExecOpts {
  timeoutMs?: number;
  memoryMb?: number;
  env?: Record<string, string>;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface SandboxRunner {
  exec(code: string, language: string, opts?: ExecOpts): Promise<ExecResult>;
}
