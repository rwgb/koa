import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock readCredentials so the tool can find an API key
vi.mock('../config/credentials.js', () => ({
  readCredentials: () => ({ BRAVE_API_KEY: 'test-key' }),
}));

describe('web_search count coercion', () => {
  let capturedUrl: string | undefined;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    capturedUrl = undefined;
    // Mock fetch to capture the URL and return a minimal valid Brave response
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        json: async () => ({
          web: {
            results: [
              { title: 'Test', url: 'https://example.com', description: 'desc' },
            ],
          },
        }),
      } as unknown as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function runSearch(count: unknown) {
    // Dynamically import the tool so the module-level mock is in place
    const { webSearchTool } = await import('../agent/tools/web_search.js');
    await webSearchTool.execute({ query: 'test', count } as Record<string, unknown>);
    return capturedUrl ?? '';
  }

  it('count=undefined → resultCount=8 (default)', async () => {
    const url = await runSearch(undefined);
    expect(url).toContain('count=8');
    expect(url).not.toContain('count=NaN');
  });

  it('count=NaN → resultCount=8 (fallback)', async () => {
    const url = await runSearch(NaN);
    expect(url).toContain('count=8');
    expect(url).not.toContain('count=NaN');
  });

  it('count=0 → resultCount=1 (clamped to minimum)', async () => {
    const url = await runSearch(0);
    expect(url).toContain('count=1');
  });

  it('count=999 → resultCount=10 (clamped to maximum)', async () => {
    const url = await runSearch(999);
    expect(url).toContain('count=10');
  });

  it('count="5" (string) → resultCount=5', async () => {
    const url = await runSearch('5');
    expect(url).toContain('count=5');
  });

  it('result is wrapped with untrusted envelope', async () => {
    const { webSearchTool } = await import('../agent/tools/web_search.js');
    const result = await webSearchTool.execute({ query: 'test' } as Record<string, unknown>);
    expect(String(result)).toContain('<<<KOA_UNTRUSTED');
    expect(String(result)).toContain('[END UNTRUSTED EXTERNAL CONTENT]');
  });
});
