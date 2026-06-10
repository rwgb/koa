import { validateSafeUrl } from '../utils/ssrf.js';

export interface PR {
  number: number;
  title: string;
  author: string;
  url: string;
  draft: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  createdAt: string;
}

export interface CheckRun {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
}

export interface CIStatus {
  prNumber: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  approvals: number;
  changesRequested: boolean;
  checks: CheckRun[];
}

const GITHUB_HEADERS = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'koa-agent/1.0',
});

function assertToken(token: string): void {
  if (!token) throw new Error('GITHUB_TOKEN not configured');
}

async function ghFetch(url: string, token: string): Promise<unknown> {
  validateSafeUrl(url);
  const res = await fetch(url, { headers: GITHUB_HEADERS(token) });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

export async function getOpenPRs(owner: string, repo: string, token: string): Promise<PR[]> {
  assertToken(token);
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`;
  const data = await ghFetch(url, token) as Array<Record<string, unknown>>;
  return data.map(pull => ({
    number: pull['number'] as number,
    title: pull['title'] as string,
    author: (pull['user'] as Record<string, unknown>)['login'] as string,
    url: pull['html_url'] as string,
    draft: pull['draft'] as boolean,
    reviewDecision: (pull['review_decision'] as PR['reviewDecision']) ?? null,
    createdAt: pull['created_at'] as string,
  }));
}

export async function getPRStatus(owner: string, repo: string, prNumber: number, token: string): Promise<CIStatus> {
  assertToken(token);
  const prUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`;
  const reviewsUrl = `https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
  const [prData, reviewsData] = await Promise.all([
    ghFetch(prUrl, token) as Promise<Record<string, unknown>>,
    ghFetch(reviewsUrl, token) as Promise<Array<Record<string, unknown>>>,
  ]);

  const sha = (prData['head'] as Record<string, unknown>)['sha'] as string;
  const checksUrl = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`;
  const checksData = await ghFetch(checksUrl, token) as Record<string, unknown>;
  const checkRuns = (checksData['check_runs'] as Array<Record<string, unknown>>);

  const approvals = reviewsData.filter(r => r['state'] === 'APPROVED').length;
  const changesRequested = reviewsData.some(r => r['state'] === 'CHANGES_REQUESTED');

  const merged = prData['merged'] as boolean;
  const state = merged ? 'merged' : (prData['state'] as 'open' | 'closed');

  return {
    prNumber,
    title: prData['title'] as string,
    state,
    approvals,
    changesRequested,
    checks: checkRuns.map(c => ({
      name: c['name'] as string,
      status: c['status'] as CheckRun['status'],
      conclusion: (c['conclusion'] as CheckRun['conclusion']) ?? null,
    })),
  };
}

export async function createIssue(owner: string, repo: string, title: string, body: string, token: string): Promise<string> {
  assertToken(token);
  const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
  validateSafeUrl(url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...GITHUB_HEADERS(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body }),
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return data['html_url'] as string;
}
