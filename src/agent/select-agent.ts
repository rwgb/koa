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

export function isCodeQuery(message: string): boolean {
  const lower = message.toLowerCase();
  return CODE_SIGNALS.some((s) => lower.includes(s));
}

export function hasBacklogSignals(message: string): boolean {
  const lower = message.toLowerCase();
  return BACKLOG_SIGNALS.some((s) => lower.includes(s));
}

export function hasLifeSignals(message: string): boolean {
  const lower = message.toLowerCase();
  return LIFE_SIGNALS.some((s) => lower.includes(s));
}

/**
 * Keyword-based agent router. No ML — deterministic and fast.
 * Life signals take priority (clearly personal). Then PM signals. Default → code.
 */
export function selectAgent(message: string): AgentName {
  if (hasLifeSignals(message)) return 'life-manager';
  if (hasBacklogSignals(message)) return 'project-manager';
  return 'code-assistant';
}
