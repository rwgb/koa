import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before any imports
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock ssrf so validation doesn't block test URLs
vi.mock('../utils/ssrf.js', () => ({
  validateSafeUrl: vi.fn(),
}));

import { getOpenPRs, getPRStatus, createIssue } from '../integrations/github.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getOpenPRs', () => {
  it('calls the correct URL and maps response to PR type', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      {
        number: 42,
        title: 'feat: add widgets',
        user: { login: 'alice' },
        html_url: 'https://github.com/owner/repo/pull/42',
        draft: false,
        review_decision: 'APPROVED',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]));

    const prs = await getOpenPRs('owner', 'repo', 'ghp_test');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://api.github.com/repos/owner/repo/pulls?state=open&per_page=100');
    expect(init.headers['Authorization']).toBe('Bearer ghp_test');
    expect(init.headers['Accept']).toBe('application/vnd.github+json');

    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 42,
      title: 'feat: add widgets',
      author: 'alice',
      url: 'https://github.com/owner/repo/pull/42',
      draft: false,
      reviewDecision: 'APPROVED',
      createdAt: '2026-01-01T00:00:00Z',
    });
  });

  it('sets reviewDecision to null when review_decision is missing', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      {
        number: 1,
        title: 'fix: typo',
        user: { login: 'bob' },
        html_url: 'https://github.com/o/r/pull/1',
        draft: true,
        created_at: '2026-02-01T00:00:00Z',
      },
    ]));

    const prs = await getOpenPRs('o', 'r', 'ghp_test');
    expect(prs[0]?.reviewDecision).toBeNull();
  });

  it('throws on non-200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(getOpenPRs('owner', 'repo', 'ghp_test')).rejects.toThrow('GitHub API error: 404');
  });

  it('throws GITHUB_TOKEN not configured when token is empty', async () => {
    await expect(getOpenPRs('owner', 'repo', '')).rejects.toThrow('GITHUB_TOKEN not configured');
  });
});

describe('getPRStatus', () => {
  it('makes three API calls and returns correct CIStatus shape', async () => {
    const prData = {
      number: 7,
      title: 'refactor: clean up',
      state: 'open',
      merged: false,
      head: { sha: 'abc123' },
    };
    const reviewsData = [
      { state: 'APPROVED', user: { login: 'reviewer1' } },
      { state: 'CHANGES_REQUESTED', user: { login: 'reviewer2' } },
    ];
    const checksData = {
      check_runs: [
        { name: 'CI / build', status: 'completed', conclusion: 'success' },
        { name: 'CI / lint', status: 'completed', conclusion: 'failure' },
      ],
    };

    mockFetch
      .mockResolvedValueOnce(jsonResponse(prData))
      .mockResolvedValueOnce(jsonResponse(reviewsData))
      .mockResolvedValueOnce(jsonResponse(checksData));

    const status = await getPRStatus('owner', 'repo', 7, 'ghp_test');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const urls = mockFetch.mock.calls.map(c => (c as [string])[0]);
    expect(urls[0]).toBe('https://api.github.com/repos/owner/repo/pulls/7');
    expect(urls[1]).toBe('https://api.github.com/repos/owner/repo/pulls/7/reviews');
    expect(urls[2]).toBe('https://api.github.com/repos/owner/repo/commits/abc123/check-runs?per_page=100');

    expect(status).toMatchObject({
      prNumber: 7,
      title: 'refactor: clean up',
      state: 'open',
      approvals: 1,
      changesRequested: true,
      checks: [
        { name: 'CI / build', status: 'completed', conclusion: 'success' },
        { name: 'CI / lint', status: 'completed', conclusion: 'failure' },
      ],
    });
  });

  it('throws GITHUB_TOKEN not configured when token is empty', async () => {
    await expect(getPRStatus('owner', 'repo', 1, '')).rejects.toThrow('GITHUB_TOKEN not configured');
  });
});

describe('createIssue', () => {
  it('POSTs to the correct URL with title+body and returns html_url', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      html_url: 'https://github.com/owner/repo/issues/99',
    }, 201));

    const url = await createIssue('owner', 'repo', 'Bug report', 'Something broke', 'ghp_test');

    expect(url).toBe('https://github.com/owner/repo/issues/99');
    const [fetchUrl, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string>; body: string }];
    expect(fetchUrl).toBe('https://api.github.com/repos/owner/repo/issues');
    expect(init.method).toBe('POST');
    const sentBody = JSON.parse(init.body) as Record<string, string>;
    expect(sentBody['title']).toBe('Bug report');
    expect(sentBody['body']).toBe('Something broke');
    expect(init.headers['Authorization']).toBe('Bearer ghp_test');
  });

  it('throws GITHUB_TOKEN not configured when token is empty', async () => {
    await expect(createIssue('owner', 'repo', 'title', 'body', '')).rejects.toThrow('GITHUB_TOKEN not configured');
  });
});
