import type { AgentName } from './specialists.js';

const CODE_SIGNALS = [
  'function', 'file', 'module', 'error', 'bug', 'src/', 'import', 'class', 'type',
  '.ts', '.js', '.py', 'test', 'lint', 'build', 'compile', 'debug', 'refactor',
  'implement', 'fix', 'deploy', 'docker', 'bash', 'script', 'api', 'endpoint',
];

const BACKLOG_SIGNALS = [
  'task', 'backlog', 'plan', 'next', 'todo', 'priority', 'should we', "what's left",
  'checkpoint', 'project', 'milestone', 'sprint', 'deadline', 'blocked', 'status',
  "what's on track", 'dependency', 'unblocked',
];

const LIFE_SIGNALS = [
  'habit', 'goal', 'personal', 'life', 'calendar', 'schedule', 'health', 'routine',
  'weekly', 'monthly', 'journal', 'focus', 'reflect', 'productivity', 'energy',
];

// Build a case-insensitive whole-word matcher for a signal phrase so "life" no
// longer matches inside "lifecycle".
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countSignalHits(message: string, signals: readonly string[]): number {
  const lower = message.toLowerCase();
  let hits = 0;
  for (const signal of signals) {
    const lsignal = signal.toLowerCase();
    // Signals containing '/' or '.' cannot use \b word-boundary (the non-word
    // characters break the anchor), so fall back to a plain substring match for
    // those specific signals only.
    if (lsignal.includes('/') || lsignal.includes('.')) {
      if (lower.includes(lsignal)) hits += 1;
    } else {
      const re = new RegExp(`\\b${escapeRegExp(lsignal)}(?:es|s)?\\b`);
      if (re.test(lower)) hits += 1;
    }
  }
  return hits;
}

export function isCodeQuery(message: string): boolean {
  return countSignalHits(message, CODE_SIGNALS) > 0;
}

export function hasBacklogSignals(message: string): boolean {
  return countSignalHits(message, BACKLOG_SIGNALS) > 0;
}

export function hasLifeSignals(message: string): boolean {
  return countSignalHits(message, LIFE_SIGNALS) > 0;
}

/**
 * Keyword-based agent router. No ML — deterministic and fast.
 *
 * Code is the default. Life/PM only override when their signals are both
 * clearly present (>= 2 whole-word hits) AND the message isn't a code query,
 * so a single incidental life/PM word can't hijack an engineering turn.
 */
export function selectAgent(message: string): AgentName {
  const code = isCodeQuery(message);
  const lifeHits = countSignalHits(message, LIFE_SIGNALS);
  const backlogHits = countSignalHits(message, BACKLOG_SIGNALS);

  if (!code && lifeHits >= 2) return 'life-manager';
  if (!code && backlogHits >= 2) return 'project-manager';
  return 'code-assistant';
}
