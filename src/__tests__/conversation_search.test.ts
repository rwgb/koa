import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  closeDb,
  createConversation,
  addConversationTurn,
  deleteConversationsBefore,
  searchConversations,
  getConversationTurns,
} from '../db/index.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-conv-search-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('searchConversations', () => {
  it('returns empty array for empty query', () => {
    expect(searchConversations('')).toEqual([]);
    expect(searchConversations('   ')).toEqual([]);
  });

  it('returns matching turn by content', () => {
    const conv = createConversation();
    addConversationTurn(conv.id, 'user', 'How do I configure OAuth in koa?');
    addConversationTurn(conv.id, 'assistant', 'You can set up OAuth by adding credentials.');

    const results = searchConversations('OAuth');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.conversationId).toBe(conv.id);
    expect(results[0]?.excerpt).toContain('OAuth');
  });

  it('result includes turnId and excerpt fields', () => {
    const conv = createConversation();
    const turn = addConversationTurn(conv.id, 'user', 'Testing FTS5 search functionality');

    const results = searchConversations('FTS5');
    expect(results.length).toBe(1);
    expect(results[0]?.turnId).toBe(turn.id);
    expect(typeof results[0]?.excerpt).toBe('string');
  });

  it('does not throw on FTS-special characters (bad-input safety)', () => {
    const conv = createConversation();
    addConversationTurn(conv.id, 'user', 'normal content');

    expect(() => searchConversations('"')).not.toThrow();
    expect(searchConversations('"')).toEqual([]);
    expect(() => searchConversations('AND OR NOT')).not.toThrow();
  });

  it('does not return turns from conversations deleted before a date', () => {
    const conv = createConversation();
    addConversationTurn(conv.id, 'user', 'This should be deleted soon');

    const future = new Date(Date.now() + 86_400_000 * 2).toISOString().slice(0, 10);
    deleteConversationsBefore(future);

    // After deletion, FTS trigger should have cleaned up the entry
    const results = searchConversations('deleted soon');
    expect(results).toEqual([]);
  });

  it('addConversationTurn populates FTS so new turns are immediately searchable', () => {
    const conv = createConversation();
    const before = searchConversations('uniqueterm12345');
    expect(before).toEqual([]);

    addConversationTurn(conv.id, 'user', 'uniqueterm12345 is my search token');
    const after = searchConversations('uniqueterm12345');
    expect(after.length).toBe(1);
  });

  it('skips FTS insert for empty content turns', () => {
    const conv = createConversation();
    addConversationTurn(conv.id, 'assistant', '');
    const turns = getConversationTurns(conv.id);
    expect(turns).toHaveLength(1);
    // empty content turn should not cause errors and returns no search results
    expect(searchConversations('')).toEqual([]);
  });
});
