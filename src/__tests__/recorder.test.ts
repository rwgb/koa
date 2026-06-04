import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

import { AudioRecorder } from '../voice/recorder.js';
import { spawn, spawnSync } from 'child_process';

const mockSpawn = vi.mocked(spawn);
const mockSpawnSync = vi.mocked(spawnSync);

describe('AudioRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('isAvailable returns true when sox is found', () => {
    mockSpawnSync.mockReturnValueOnce({ status: 0 } as any);
    const rec = new AudioRecorder();
    expect(rec.isAvailable()).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledWith('which', ['sox']);
  });

  it('isAvailable returns false when sox is not found', () => {
    mockSpawnSync.mockReturnValueOnce({ status: 1 } as any);
    const rec = new AudioRecorder();
    expect(rec.isAvailable()).toBe(false);
  });

  it('isAvailable returns false when spawnSync throws', () => {
    mockSpawnSync.mockImplementationOnce(() => { throw new Error('not found'); });
    const rec = new AudioRecorder();
    expect(rec.isAvailable()).toBe(false);
  });

  it('stop kills the process and returns concatenated buffer', () => {
    const mockProc = { stdout: null, on: vi.fn(), kill: vi.fn() };
    mockSpawn.mockReturnValueOnce(mockProc as any);
    const rec = new AudioRecorder();
    rec.start();
    const buf = rec.stop();
    expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('stop without start returns empty buffer', () => {
    const rec = new AudioRecorder();
    const buf = rec.stop();
    expect(buf.length).toBe(0);
  });
});
