#!/usr/bin/env node
/**
 * AI code review for GitHub Actions.
 *
 * Required env: ANTHROPIC_API_KEY, GH_TOKEN, PR_NUMBER, GITHUB_REPOSITORY, GITHUB_SHA
 *
 * Exit 0 → PASS (no CRITICAL/HIGH findings)
 * Exit 1 → FAIL (blocking findings or script error)
 */

const { ANTHROPIC_API_KEY, GH_TOKEN, PR_NUMBER, GITHUB_REPOSITORY, GITHUB_SHA } = process.env;

for (const v of ['ANTHROPIC_API_KEY', 'GH_TOKEN', 'PR_NUMBER', 'GITHUB_REPOSITORY', 'GITHUB_SHA']) {
  if (!process.env[v]) { console.error(`Missing required env var: ${v}`); process.exit(1); }
}

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const MAX_DIFF_CHARS = 60_000; // ~15k tokens; large PRs get truncated

// --- GitHub API helpers ---

async function ghFetch(path, opts = {}) {
  const url = path.startsWith('https://') ? path : `https://api.github.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub ${path}: ${res.status} — ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function getPR() {
  return ghFetch(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}`);
}

async function getDiff() {
  // Use /files endpoint — the raw diff endpoint returns 406 for PRs over 20k lines
  const files = [];
  let page = 1;
  while (true) {
    const batch = await ghFetch(`/repos/${owner}/${repo}/pulls/${PR_NUMBER}/files?per_page=100&page=${page}`);
    if (!batch || batch.length === 0) break;
    files.push(...batch);
    if (batch.length < 100) break;
    page++;
    if (files.length >= 3000) break;
  }

  const parts = [];
  for (const file of files) {
    parts.push(`diff --git a/${file.filename} b/${file.filename}`);
    if (file.status === 'added') parts.push('new file mode 100644');
    if (file.status === 'deleted') parts.push('deleted file mode 100644');
    parts.push(`--- a/${file.filename}\n+++ b/${file.filename}`);
    parts.push(file.patch ?? `[no patch — binary or too large (${file.changes} changes)]`);
    parts.push('');
  }

  const diff = parts.join('\n');
  const truncated = diff.length > MAX_DIFF_CHARS;
  return truncated
    ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[...diff truncated — exceeds 60 KB limit]'
    : diff;
}

async function postComment(body) {
  return ghFetch(`/repos/${owner}/${repo}/issues/${PR_NUMBER}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

async function setCommitStatus(state, description) {
  return ghFetch(`/repos/${owner}/${repo}/statuses/${GITHUB_SHA}`, {
    method: 'POST',
    body: JSON.stringify({
      state,           // pending | success | failure | error
      description: description.slice(0, 140),
      context: 'ai-review',
      target_url: `https://github.com/${owner}/${repo}/pull/${PR_NUMBER}`,
    }),
  });
}

// --- Claude review ---

const REVIEW_PROMPT = (diff, title, body) => `\
You are a senior software engineer performing a rigorous code review. Analyse the pull request diff below and report all issues you find.

Severity definitions:
- CRITICAL: Security vulnerabilities (injection, auth bypass, secret exposure, SSRF, privilege escalation), data loss or corruption
- HIGH:     Logic bugs, race conditions, incorrect error handling, missing input validation at trust boundaries, broken behaviour
- MEDIUM:   Performance problems, missing edge cases, confusing code, incomplete error handling
- LOW:      Style, naming, minor improvements, documentation gaps

PR Title: ${title}
PR Description:
${body?.trim() || '(none provided)'}

Diff:
\`\`\`diff
${diff}
\`\`\`

Respond with ONLY a JSON object inside a single \`\`\`json code block — no text before or after it.

{
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "file": "path/to/file.ts",
      "line": 42,
      "description": "What the issue is and why it matters",
      "suggestion": "Specific, actionable fix"
    }
  ],
  "summary": "2-3 sentence overall assessment of the PR — quality, risks, and whether it is production-ready",
  "verdict": "PASS or FAIL"
}

Rules:
- verdict MUST be FAIL if any CRITICAL or HIGH finding exists, PASS otherwise
- If no findings, return an empty array and PASS
- Reference exact file paths and line numbers visible in the diff
- Do not invent issues that are not present in the diff`;

async function callClaude(diff, prTitle, prBody) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: REVIEW_PROMPT(diff, prTitle, prBody) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API: ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text ?? '';

  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error(`Could not extract JSON from Claude response:\n${text.slice(0, 500)}`);

  return JSON.parse(match[1]);
}

// --- Format review as Markdown comment ---

const SEV_ICON = { CRITICAL: '🚨', HIGH: '🔴', MEDIUM: '🟡', LOW: '🔵' };

function formatComment(review) {
  const { findings, summary, verdict } = review;
  const passed = verdict === 'PASS';
  const badge = passed ? '✅ **PASS**' : '❌ **FAIL**';

  const blocking = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const nonBlocking = findings.filter(f => f.severity === 'MEDIUM' || f.severity === 'LOW');

  let md = `## AI Code Review — ${badge}\n\n${summary}\n`;

  if (findings.length === 0) {
    md += '\n_No issues found. Looking good!_\n';
  } else {
    for (const sev of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      const group = findings.filter(f => f.severity === sev);
      if (group.length === 0) continue;
      md += `\n### ${SEV_ICON[sev]} ${sev} (${group.length})\n\n`;
      for (const f of group) {
        md += `**\`${f.file}\`** (line ${f.line})\n`;
        md += `> ${f.description}\n\n`;
        md += `**Fix:** ${f.suggestion}\n\n`;
      }
    }
  }

  if (!passed) {
    md += `\n> **Merge blocked** — ${blocking.length} blocking finding(s) must be resolved before this PR can be merged.\n`;
  }

  md += `\n---\n_Reviewed by [Claude Sonnet 4.6](https://anthropic.com) · Pass threshold: no CRITICAL or HIGH findings_`;
  return md;
}

// --- Main ---

async function main() {
  console.log(`\nAI review: PR #${PR_NUMBER} in ${owner}/${repo}`);
  console.log(`SHA: ${GITHUB_SHA}\n`);

  await setCommitStatus('pending', 'AI code review in progress…');

  const [pr, diff] = await Promise.all([getPR(), getDiff()]);
  console.log(`Diff: ${diff.length.toLocaleString()} chars`);

  let review;
  try {
    review = await callClaude(diff, pr.title, pr.body);
  } catch (err) {
    await setCommitStatus('error', `Review script error: ${err.message.slice(0, 100)}`);
    throw err;
  }

  const { findings, verdict } = review;
  const blocking = findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  console.log(`Verdict: ${verdict}  |  Findings: ${findings.length} total, ${blocking.length} blocking`);

  await postComment(formatComment(review));

  const passed = verdict === 'PASS';
  await setCommitStatus(
    passed ? 'success' : 'failure',
    passed
      ? `Passed — ${findings.length} finding(s), none blocking`
      : `Failed — ${blocking.length} blocking finding(s) (CRITICAL/HIGH)`,
  );

  if (!passed) {
    console.error('\nReview FAILED. Blocking findings must be resolved.');
    process.exit(1);
  }

  console.log('\nReview PASSED.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
