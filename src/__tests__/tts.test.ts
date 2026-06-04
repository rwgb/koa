import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: { pipe: vi.fn() },
    on: vi.fn(),
    unref: vi.fn(),
  })),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

vi.mock('../config/credentials.js', () => ({
  readCredentials: vi.fn(() => ({})),
}));

import { isTtsAvailable, cleanText, speak } from '../voice/tts.js';
import { spawnSync } from 'child_process';
import { readCredentials } from '../config/credentials.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isTtsAvailable()', () => {
  it('returns true for say when spawnSync status 0', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);
    expect(isTtsAvailable('say')).toBe(true);
  });

  it('returns false for say when spawnSync status 1', () => {
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
    expect(isTtsAvailable('say')).toBe(false);
  });

  it('returns false for elevenlabs when no API key', () => {
    vi.mocked(readCredentials).mockReturnValue({});
    expect(isTtsAvailable('elevenlabs')).toBe(false);
  });

  it('returns true for elevenlabs when API key is set', () => {
    vi.mocked(readCredentials).mockReturnValue({ ELEVENLABS_API_KEY: 'test-key' });
    expect(isTtsAvailable('elevenlabs')).toBe(true);
  });
});

describe('cleanText()', () => {
  it('strips code fences, markdown chars and truncates at 500 chars', () => {
    const input = '**bold** _italic_ `code` # heading\n```\nsome code\n```\n' + 'x'.repeat(600);
    const result = cleanText(input);
    expect(result).not.toContain('**');
    expect(result).not.toContain('```');
    expect(result.length).toBeLessThanOrEqual(500);
  });
});
