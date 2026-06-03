import type { Tool } from '../../types/index.js';
import { loadIntegrations } from '../../integrations/store.js';
import { getOpenPRs, getPRStatus, createIssue } from '../../integrations/github.js';

function getGitHubCredentials() {
  const integrations = loadIntegrations();
  const gh = integrations.find(i => i.type === 'github');
  return {
    token: gh?.config['token'] as string ?? '',
    defaultRepo: gh?.config['defaultRepo'] as string ?? '',
  };
}

function parseRepo(repoStr: string): { owner: string; repo: string } | null {
  const parts = repoStr.split('/');
  return parts.length === 2 && parts[0] && parts[1]
    ? { owner: parts[0], repo: parts[1] }
    : null;
}

const listPRsTool: Tool = {
  name: 'list_prs',
  description: 'List open pull requests for a GitHub repository.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: { type: 'string', description: 'Repository in owner/repo format (optional, uses default if not provided)' },
    },
    required: [],
  },
  async execute(input) {
    const { repo } = input as { repo?: unknown };
    const { token, defaultRepo } = getGitHubCredentials();
    const repoStr = (typeof repo === 'string' && repo) ? repo : defaultRepo;
    if (!repoStr) return 'Error: no repo specified and no default repo configured';
    const parsed = parseRepo(repoStr);
    if (!parsed) return `Error: invalid repo format "${repoStr}" — expected owner/repo`;
    try {
      const prs = await getOpenPRs(parsed.owner, parsed.repo, token);
      if (prs.length === 0) return 'No open PRs found.';
      return prs.map(pr => {
        const draft = pr.draft ? ' [DRAFT]' : '';
        const decision = pr.reviewDecision ?? 'REVIEW_REQUIRED';
        return `#${pr.number} ${pr.title} by ${pr.author}${draft} — ${decision}`;
      }).join('\n');
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
};

const getPRStatusTool: Tool = {
  name: 'get_pr_status',
  description: 'Get the CI status, review state, and check runs for a specific pull request.',
  inputSchema: {
    type: 'object',
    properties: {
      pr_number: { type: 'number', description: 'Pull request number' },
      repo: { type: 'string', description: 'Repository in owner/repo format (optional, uses default if not provided)' },
    },
    required: ['pr_number'],
  },
  async execute(input) {
    const { pr_number, repo } = input as { pr_number?: unknown; repo?: unknown };
    if (typeof pr_number !== 'number') return 'Error: pr_number is required';
    const { token, defaultRepo } = getGitHubCredentials();
    const repoStr = (typeof repo === 'string' && repo) ? repo : defaultRepo;
    if (!repoStr) return 'Error: no repo specified and no default repo configured';
    const parsed = parseRepo(repoStr);
    if (!parsed) return `Error: invalid repo format "${repoStr}" — expected owner/repo`;
    try {
      const status = await getPRStatus(parsed.owner, parsed.repo, pr_number, token);
      const lines: string[] = [
        status.title,
        `State: ${status.state}`,
        `${status.approvals} approval(s)`,
        status.changesRequested ? 'Changes requested' : 'No changes requested',
      ];
      for (const check of status.checks) {
        lines.push(`  - ${check.name}: ${check.status} (${check.conclusion ?? 'pending'})`);
      }
      return lines.join('\n');
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
};

const createGitHubIssueTool: Tool = {
  name: 'create_github_issue',
  description: 'Create a new issue in a GitHub repository.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Issue title' },
      body: { type: 'string', description: 'Issue body / description' },
      repo: { type: 'string', description: 'Repository in owner/repo format (optional, uses default if not provided)' },
    },
    required: ['title', 'body'],
  },
  async execute(input) {
    const { title, body, repo } = input as { title?: unknown; body?: unknown; repo?: unknown };
    if (!title || typeof title !== 'string') return 'Error: title is required';
    if (!body || typeof body !== 'string') return 'Error: body is required';
    const { token, defaultRepo } = getGitHubCredentials();
    const repoStr = (typeof repo === 'string' && repo) ? repo : defaultRepo;
    if (!repoStr) return 'Error: no repo specified and no default repo configured';
    const parsed = parseRepo(repoStr);
    if (!parsed) return `Error: invalid repo format "${repoStr}" — expected owner/repo`;
    try {
      const url = await createIssue(parsed.owner, parsed.repo, title, body, token);
      return `Created issue: ${url}`;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  },
};

export const githubTools = [listPRsTool, getPRStatusTool, createGitHubIssueTool];
