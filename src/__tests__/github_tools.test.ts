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

type InstanceSpec = { id: string; token: string; defaultRepo: string; status?: 'connected' | 'not_configured' | 'error' };

function withGitHubInstances(...specs: InstanceSpec[]) {
  mockLoadIntegrations.mockReturnValue(specs.map(s => ({
    id: s.id,
    type: 'github',
    name: s.id,
    status: s.status ?? 'connected',
    config: { token: s.token, defaultRepo: s.defaultRepo },
  })));
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

// ── multi-instance credential resolution ──────────────────────────────────────

describe('multi-instance GitHub resolution', () => {
  const work = { id: 'github', token: 'ghp_work', defaultRepo: 'acme/platform' };
  const personal = { id: 'github-uuid-1', token: 'ghp_personal', defaultRepo: 'ralph/homelab' };

  it('list_prs picks the instance whose defaultRepo owner matches the target repo owner', async () => {
    withGitHubInstances(work, personal);
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'ralph/side-project' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('ralph', 'side-project', 'ghp_personal');
  });

  it('matches owner case-insensitively', async () => {
    withGitHubInstances(work, personal);
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'RaLpH/side-project' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('RaLpH', 'side-project', 'ghp_personal');
  });

  it('falls back to the first connected instance when no owner matches', async () => {
    withGitHubInstances({ ...work, status: 'not_configured' }, personal);
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'someone-else/repo' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('someone-else', 'repo', 'ghp_personal');
  });

  it('prefers a connected instance among the matches when multiple instances match the owner', async () => {
    withGitHubInstances(work, { id: 'github-uuid-2', token: 'ghp_work2', defaultRepo: 'acme/infra' });
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'acme/website' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('acme', 'website', 'ghp_work');
  });

  it('never selects a non-matching instance when multiple instances match the owner', async () => {
    // personal listed first: the multi-match fallback must stay within the
    // matching (acme) instances, not leak the personal token.
    withGitHubInstances(
      personal,
      { id: 'github-work-1', token: 'ghp_work', defaultRepo: 'acme/platform' },
      { id: 'github-work-2', token: 'ghp_work2', defaultRepo: 'acme/infra' },
    );
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'acme/website' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('acme', 'website', 'ghp_work');
  });

  it('prefers the connected matching instance over a non-connected one on multi-match', async () => {
    withGitHubInstances(
      personal,
      { id: 'github-work-1', token: 'ghp_work', defaultRepo: 'acme/platform', status: 'error' },
      { id: 'github-work-2', token: 'ghp_work2', defaultRepo: 'acme/infra' },
    );
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'acme/website' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('acme', 'website', 'ghp_work2');
  });

  it('uses the first instance defaultRepo when no repo arg is given (legacy behavior)', async () => {
    withGitHubInstances(work, personal);
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({});

    expect(mockGetOpenPRs).toHaveBeenCalledWith('acme', 'platform', 'ghp_work');
  });

  it('get_pr_status resolves credentials by target repo owner', async () => {
    withGitHubInstances(work, personal);
    mockGetPRStatus.mockResolvedValueOnce({
      prNumber: 7, title: 'fix: dns', state: 'open', approvals: 0, changesRequested: false, checks: [],
    });

    await getPRStatusTool.execute({ pr_number: 7, repo: 'ralph/homelab' });

    expect(mockGetPRStatus).toHaveBeenCalledWith('ralph', 'homelab', 7, 'ghp_personal');
  });

  it('create_github_issue resolves credentials by target repo owner', async () => {
    withGitHubInstances(work, personal);
    mockCreateIssue.mockResolvedValueOnce('https://github.com/acme/platform/issues/1');

    await createIssueTool.execute({ title: 'Bug', body: 'Details', repo: 'acme/platform' });

    expect(mockCreateIssue).toHaveBeenCalledWith('acme', 'platform', 'Bug', 'Details', 'ghp_work');
  });

  it('ignores instances with unparseable defaultRepo when matching', async () => {
    withGitHubInstances({ id: 'github-bad', token: 'ghp_bad', defaultRepo: 'not-a-repo' }, personal);
    mockGetOpenPRs.mockResolvedValueOnce([]);

    await listPRsTool.execute({ repo: 'ralph/homelab' });

    expect(mockGetOpenPRs).toHaveBeenCalledWith('ralph', 'homelab', 'ghp_personal');
  });
});
