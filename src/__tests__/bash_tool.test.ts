import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock execa before importing the tool
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { bashTool } from '../agent/tools/bash.js';
import { execa } from 'execa';

const mockExeca = vi.mocked(execa);

describe('bashTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes a command and returns stdout', async () => {
    mockExeca.mockResolvedValueOnce({ all: 'hello', stdout: 'hello', stderr: '', exitCode: 0 } as never);
    const result = await bashTool.execute({ command: 'echo hello' });
    expect(result).toBe('hello');
    expect(mockExeca).toHaveBeenCalledWith('bash', ['-c', 'echo hello'], expect.objectContaining({ timeout: 30_000 }));
  });

  it('includes stderr on non-zero exit', async () => {
    mockExeca.mockResolvedValueOnce({ all: 'some output', stdout: '', stderr: 'error msg', exitCode: 1 } as never);
    const result = await bashTool.execute({ command: 'false' });
    expect(result).toContain('Exit 1');
    expect(result).toContain('error msg');
  });

  it('respects custom timeout within max ceiling', async () => {
    mockExeca.mockResolvedValueOnce({ all: '', stdout: '', stderr: '', exitCode: 0 } as never);
    await bashTool.execute({ command: 'sleep 1', timeout: 60_000 });
    expect(mockExeca).toHaveBeenCalledWith('bash', ['-c', 'sleep 1'], expect.objectContaining({ timeout: 60_000 }));
  });

  it('clamps timeout at 300s ceiling', async () => {
    mockExeca.mockResolvedValueOnce({ all: '', stdout: '', stderr: '', exitCode: 0 } as never);
    await bashTool.execute({ command: 'sleep 1', timeout: 999_999 });
    expect(mockExeca).toHaveBeenCalledWith('bash', ['-c', 'sleep 1'], expect.objectContaining({ timeout: 300_000 }));
  });

  it('returns exit code marker when output is empty', async () => {
    mockExeca.mockResolvedValueOnce({ all: '', stdout: '', stderr: '', exitCode: 0 } as never);
    const result = await bashTool.execute({ command: 'true' });
    expect(result).toContain('exit 0');
  });
});
