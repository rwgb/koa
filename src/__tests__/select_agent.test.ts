import { describe, it, expect } from 'vitest';
import { selectAgent, isCodeQuery, hasBacklogSignals, hasLifeSignals } from '../agent/select-agent.js';

// ── isCodeQuery ───────────────────────────────────────────────────────────────

describe('isCodeQuery()', () => {
  it('matches function keyword', () => expect(isCodeQuery('What does this function do?')).toBe(true));
  it('matches file path', () => expect(isCodeQuery('edit src/agent/loop.ts')).toBe(true));
  it('matches bug keyword', () => expect(isCodeQuery('there is a bug in the login flow')).toBe(true));
  it('matches .ts extension', () => expect(isCodeQuery('look at index.ts')).toBe(true));
  it('matches build', () => expect(isCodeQuery('run the build')).toBe(true));
  it('matches fix', () => expect(isCodeQuery('fix the auth error')).toBe(true));
  it('does not match plain question', () => expect(isCodeQuery("what's the weather like?")).toBe(false));
  it('does not match session summary', () => expect(isCodeQuery('summarise my last session')).toBe(false));
  // word-boundary: "lifecycle" must not trigger the "life" life signal
  it('does not match life inside lifecycle', () => expect(isCodeQuery('explain the component lifecycle')).toBe(false));
});

// ── hasBacklogSignals ─────────────────────────────────────────────────────────

describe('hasBacklogSignals()', () => {
  it('matches task', () => expect(hasBacklogSignals('what task should I do next?')).toBe(true));
  it('matches backlog', () => expect(hasBacklogSignals('show me the backlog')).toBe(true));
  it('matches next', () => expect(hasBacklogSignals("what's next?")).toBe(true));
  it('matches priority', () => expect(hasBacklogSignals('what is the priority?')).toBe(true));
  it('matches project', () => expect(hasBacklogSignals('show me all projects')).toBe(true));
  it('matches status', () => expect(hasBacklogSignals("what's the status on koa?")).toBe(true));
  it('does not match general hello', () => expect(hasBacklogSignals('hello, how are you?')).toBe(false));
  it('does not match pure code question', () => expect(hasBacklogSignals('explain this error')).toBe(false));
});

// ── hasLifeSignals ────────────────────────────────────────────────────────────

describe('hasLifeSignals()', () => {
  it('matches habit', () => expect(hasLifeSignals('how are my habits looking?')).toBe(true));
  it('matches goal', () => expect(hasLifeSignals('what are my goals?')).toBe(true));
  it('matches weekly', () => expect(hasLifeSignals('weekly review')).toBe(true));
  it('matches productivity', () => expect(hasLifeSignals('how is my productivity?')).toBe(true));
  it('does not match code', () => expect(hasLifeSignals('fix the bug in loop.ts')).toBe(false));
  it('does not match tasks', () => expect(hasLifeSignals('what task is next?')).toBe(false));
  // word-boundary: "life" must not fire inside "lifecycle"
  it('does not match life inside lifecycle', () => expect(hasLifeSignals('component lifecycle')).toBe(false));
});

// ── selectAgent ───────────────────────────────────────────────────────────────

describe('selectAgent() routing', () => {
  it('routes code queries to code-assistant', () => {
    expect(selectAgent('fix the bug in src/agent/loop.ts')).toBe('code-assistant');
  });

  it('routes multi-signal backlog queries to project-manager', () => {
    expect(selectAgent('what task should I do next?')).toBe('project-manager');
  });

  // Single life signal is not enough to override the code-assistant default.
  // The >= 2 hit requirement guards against incidental word matches.
  it('routes single-life-signal messages to code-assistant', () => {
    expect(selectAgent('how are my habits this week?')).toBe('code-assistant');
  });

  it('routes multi-signal PM queries to project-manager', () => {
    expect(selectAgent("what's on track for the koa project?")).toBe('project-manager');
  });

  // Single life signal not enough to override default.
  it('routes single weekly-review message to code-assistant', () => {
    expect(selectAgent('give me my weekly review')).toBe('code-assistant');
  });

  it('defaults unknown messages to code-assistant', () => {
    expect(selectAgent('hello')).toBe('code-assistant');
    expect(selectAgent('can you explain this to me?')).toBe('code-assistant');
  });

  // With >= 2 signal requirement, a 1-life + 1-backlog split does not meet
  // the threshold for either category — defaults to code-assistant.
  it('defaults split life+backlog single-hit messages to code-assistant', () => {
    expect(selectAgent('habit tracking task for this week')).toBe('code-assistant');
  });

  it('routes implement/refactor to code-assistant', () => {
    expect(selectAgent('implement the new auth flow')).toBe('code-assistant');
    expect(selectAgent('refactor the database layer')).toBe('code-assistant');
  });

  it('routes deploy queries to code-assistant', () => {
    expect(selectAgent('deploy the latest build')).toBe('code-assistant');
  });

  // Single backlog signal is not enough to override the default.
  it('routes single-deadline message to code-assistant', () => {
    expect(selectAgent('what are the upcoming deadlines?')).toBe('code-assistant');
  });

  // ── Spec D-5 required test cases ──────────────────────────────────────────

  // "lifecycle" previously triggered the "life" signal via substring match.
  // With word-boundary matching, it no longer does.
  it('D-5: "explain the component lifecycle" routes to code-assistant', () => {
    expect(selectAgent('explain the component lifecycle')).toBe('code-assistant');
  });

  // Multiple life signals (goals + habits) with no code signals → life-manager.
  it('D-5: "plan my week and review my goals and habits" routes to life-manager', () => {
    expect(selectAgent('plan my week and review my goals and habits')).toBe('life-manager');
  });

  // Multiple backlog signals (next + sprint + backlog) with no code signals → PM.
  it('D-5: "whats next on the sprint backlog" routes to project-manager', () => {
    expect(selectAgent('whats next on the sprint backlog')).toBe('project-manager');
  });

  // Code signals (bug + src/) take priority even when life signal (calendar) present.
  it('D-5: "fix the calendar sync bug in src/" routes to code-assistant', () => {
    expect(selectAgent('fix the calendar sync bug in src/')).toBe('code-assistant');
  });

  // No signals → default code-assistant.
  it('D-5: "whats the weather" routes to code-assistant', () => {
    expect(selectAgent('whats the weather')).toBe('code-assistant');
  });
});
