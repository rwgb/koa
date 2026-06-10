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
});

// ── selectAgent ───────────────────────────────────────────────────────────────

describe('selectAgent() routing', () => {
  it('routes code queries to code-assistant', () => {
    expect(selectAgent('fix the bug in src/agent/loop.ts')).toBe('code-assistant');
  });

  it('routes backlog queries to project-manager', () => {
    expect(selectAgent('what task should I do next?')).toBe('project-manager');
  });

  it('routes life queries to life-manager', () => {
    expect(selectAgent('how are my habits this week?')).toBe('life-manager');
  });

  it('routes status questions to project-manager', () => {
    expect(selectAgent("what's on track for the koa project?")).toBe('project-manager');
  });

  it('routes weekly review to life-manager', () => {
    expect(selectAgent('give me my weekly review')).toBe('life-manager');
  });

  it('defaults unknown messages to code-assistant', () => {
    expect(selectAgent('hello')).toBe('code-assistant');
    expect(selectAgent('can you explain this to me?')).toBe('code-assistant');
  });

  it('prefers life-manager over project-manager when both signals present', () => {
    // life signals take priority in selectAgent
    expect(selectAgent('habit tracking task for this week')).toBe('life-manager');
  });

  it('routes implement/refactor to code-assistant', () => {
    expect(selectAgent('implement the new auth flow')).toBe('code-assistant');
    expect(selectAgent('refactor the database layer')).toBe('code-assistant');
  });

  it('routes deploy queries to code-assistant', () => {
    expect(selectAgent('deploy the latest build')).toBe('code-assistant');
  });

  it('routes deadline questions to project-manager', () => {
    expect(selectAgent('what are the upcoming deadlines?')).toBe('project-manager');
  });
});
