import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn(),
}));

vi.mock('../integrations/github.js', () => ({
  getOpenPRs: vi.fn(),
  getPRStatus: vi.fn(),
  createIssue: vi.fn(),
}));

import { loadIntegrations } from '../integrations/store.js';
import { getOpenPRs, getPRStatus, createIssue } from '../integrations/github.js';
import { githubTools } from '../agent/tools/github.js';

const mockLoadIntegrations = vi.mocked(loadIntegrations);
const mockGetOpenPRs = vi.mocked(getOpenPRs);
const mockGetPRStatus = vi.mocked(getPRStatus);
const mockCreateIssue = vi.mocked(createIssue);

const listPRsTool = githubTools[0]!;
const getPRStatusTool = githubTools[1]!;
const createIssueTool = githubTools[2]!;

function withGitHub(token: string, defaultRepo: string) {
  mockLoadIntegrations.mockReturnValue([
    { id: 'github', type: 'github', name: 'GitHub', status: 'connected', config: { token, defaultRepo } },
  ]);
}

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── list_prs ──────────────────────────────────────────────────────────────────

describe('list_prs', () => {
  it('calls getOpenPRs with correct owner/repo from input and returns formatted text', async () => {
    withGitHub('ghp_abc', '');
    mockGetOpenPRs.mockResolvedValueOnce([
      { number: 1, title: 'Add feature', author: 'alice', url: 'https://github.com/o/r/pull/1', draft: false, reviewDecision: 'APPROVED', createdAt: '2026-01-01T00:00:00Z' },
      { number: 2, title: 'Fix bug', author: 'bob', url: 'https://github.com/o/r/pull/2', draft: true, reviewDecision: null, createdAt: '2026-01-02T00:00:00Z' },
    ]);

    const result = await listPRsTool.execute({ repo: 'owner/myrepo' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('owner', 'myrepo', 'ghp_abc');
    expect(result).toContain('#1 Add feature by alice — APPROVED');
    expect(result).toContain('#2 Fix bug by bob [DRAFT] — REVIEW_REQUIRED');
  });

  it('uses defaultRepo when no repo input is provided', async () => {
    withGitHub('ghp_xyz', 'org/default-repo');
    mockGetOpenPRs.mockResolvedValueOnce([]);

    const result = await listPRsTool.execute({});

    expect(mockGetOpenPRs).toHaveBeenCalledWith('org', 'default-repo', 'ghp_xyz');
    expect(result).toBe('No open PRs found.');
  });

  it('returns error string when no repo is available', async () => {
    withGitHub('ghp_xyz', '');

    const result = await listPRsTool.execute({});

    expect(result).toContain('Error');
    expect(mockGetOpenPRs).not.toHaveBeenCalled();
  });

  it('returns error string when token is missing (no throw)', async () => {
    withGitHub('', 'owner/repo');
    mockGetOpenPRs.mockRejectedValueOnce(new Error('GITHUB_TOKEN not configured'));

    const result = await listPRsTool.execute({ repo: 'owner/repo' });

    expect(typeof result).toBe('string');
    expect(result).toContain('GITHUB_TOKEN not configured');
  });
});

// ── get_pr_status ─────────────────────────────────────────────────────────────

describe('get_pr_status', () => {
  it('formats CIStatus correctly and does not expose token', async () => {
    withGitHub('ghp_secret', 'owner/repo');
    mockGetPRStatus.mockResolvedValueOnce({
      prNumber: 5,
      title: 'chore: bump deps',
      state: 'open',
      approvals: 2,
      changesRequested: false,
      checks: [
        { name: 'build', status: 'completed', conclusion: 'success' },
      ],
    });

    const result = await getPRStatusTool.execute({ pr_number: 5, repo: 'owner/repo' });

    expect(typeof result).toBe('string');
    expect(result as string).toContain('chore: bump deps');
    expect(result as string).toContain('2 approval(s)');
    expect(result as string).toContain('build: completed (success)');
    expect(result as string).not.toContain('ghp_secret');
  });

  it('returns error string when pr_number is missing', async () => {
    withGitHub('ghp_xyz', 'owner/repo');

    const result = await getPRStatusTool.execute({ repo: 'owner/repo' });

    expect(result).toContain('Error');
    expect(mockGetPRStatus).not.toHaveBeenCalled();
  });
});

// ── create_github_issue ───────────────────────────────────────────────────────

describe('create_github_issue', () => {
  it('returns the created issue URL', async () => {
    withGitHub('ghp_abc', 'owner/repo');
    mockCreateIssue.mockResolvedValueOnce('https://github.com/owner/repo/issues/10');

    const result = await createIssueTool.execute({ title: 'Bug', body: 'Details here', repo: 'owner/repo' });

    expect(result).toBe('Created issue: https://github.com/owner/repo/issues/10');
    expect(mockCreateIssue).toHaveBeenCalledWith('owner', 'repo', 'Bug', 'Details here', 'ghp_abc');
  });

  it('returns error string when title is missing', async () => {
    withGitHub('ghp_abc', 'owner/repo');

    const result = await createIssueTool.execute({ body: 'Details', repo: 'owner/repo' });

    expect(result).toContain('Error');
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it('returns error string when API throws (no throw propagated)', async () => {
    withGitHub('ghp_abc', 'owner/repo');
    mockCreateIssue.mockRejectedValueOnce(new Error('GitHub API error: 422'));

    const result = await createIssueTool.execute({ title: 'Issue', body: 'Body', repo: 'owner/repo' });

    expect(result).toContain('GitHub API error: 422');
  });
});
