import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally before any imports
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Prevent real `say` / sox spawns on non-macOS CI runners
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ stdout: { on: vi.fn() }, stderr: { on: vi.fn() }, on: vi.fn(), unref: vi.fn() })),
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

// Mock readCredentials so tests don't touch ~/.koa
vi.mock('../config/credentials.js', () => ({
  readCredentials: () => ({}),
}));

// Import the modules under test after mocks are in place
const { transcribeAudio } = await import('../voice/whisper.js');
const { speak } = await import('../voice/tts.js');

describe('transcribeAudio', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    delete process.env['OPENAI_API_KEY'];
  });

  it('throws when audio exceeds 25MB', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    const bigBuffer = Buffer.alloc(26 * 1024 * 1024);
    await expect(transcribeAudio(bigBuffer)).rejects.toThrow('25MB');
  });

  it('throws when OPENAI_API_KEY not set', async () => {
    // readCredentials is mocked to return {} and env var is not set
    await expect(transcribeAudio(Buffer.from('x'))).rejects.toThrow('OPENAI_API_KEY');
  });

  it('returns transcribed text on success', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello world' }),
    });
    const result = await transcribeAudio(Buffer.from('fake-audio'));
    expect(result).toBe('hello world');
  });

  it('throws on Whisper API error', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-test';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    });
    await expect(transcribeAudio(Buffer.from('x'))).rejects.toThrow('Whisper API returned an error (400)');
  });

  it('sends Authorization header with Bearer token', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-secret';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'ok' }),
    });
    await transcribeAudio(Buffer.from('audio'));
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['Authorization']).toBe('Bearer sk-secret');
  });
});

describe('speak', () => {
  it('strips markdown before speaking without throwing', () => {
    expect(() => speak('**bold** and `code` and # heading')).not.toThrow();
  });

  it('truncates to 500 characters without throwing', () => {
    expect(() => speak('x'.repeat(1000))).not.toThrow();
  });
});
