import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  closeDb,
  createConversation,
  getConversation,
  addConversationTurn,
  getConversationTurns,
  closeConversation,
  listConversations,
  deleteConversationsBefore,
} from '../db/index.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-conv-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('createConversation / getConversation', () => {
  it('createConversation creates a row with expected defaults', () => {
    const conv = createConversation();
    expect(conv.id).toBeTruthy();
    expect(conv.title).toBeNull();
    expect(conv.ended_at).toBeNull();
    expect(conv.turn_count).toBe(0);
    expect(conv.project_id).toBeNull();
    expect(conv.started_at).toBeTruthy();
  });

  it('getConversation retrieves by id', () => {
    const conv = createConversation();
    const fetched = getConversation(conv.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(conv.id);
  });

  it('getConversation returns null for unknown id', () => {
    expect(getConversation('does-not-exist')).toBeNull();
  });

  it('createConversation stores project_id when provided', () => {
    const conv = createConversation('proj-123');
    expect(getConversation(conv.id)!.project_id).toBe('proj-123');
  });
});

describe('addConversationTurn / getConversationTurns', () => {
  it('inserts user and assistant turns; getConversationTurns returns them in order', () => {
    const conv = createConversation();
    addConversationTurn(conv.id, 'user', 'Hello');
    addConversationTurn(conv.id, 'assistant', 'Hi there', {
      agentName: 'code-assistant',
      model: 'claude-sonnet-4-6',
      costUsd: 0.001,
      toolUses: [{ id: 't1', name: 'read_file', input: {} }],
    });

    const turns = getConversationTurns(conv.id);
    expect(turns.length).toBe(2);
    expect(turns[0]!.role).toBe('user');
    expect(turns[0]!.content).toBe('Hello');
    expect(turns[1]!.role).toBe('assistant');
    expect(turns[1]!.content).toBe('Hi there');
    expect(turns[1]!.agent_name).toBe('code-assistant');
    expect(turns[1]!.model).toBe('claude-sonnet-4-6');
    expect(turns[1]!.cost_usd).toBeCloseTo(0.001);
    expect(JSON.parse(turns[1]!.tool_uses)).toHaveLength(1);
  });

  it('tool_uses defaults to empty JSON array', () => {
    const conv = createConversation();
    addConversationTurn(conv.id, 'user', 'ping');
    const [turn] = getConversationTurns(conv.id);
    expect(JSON.parse(turn!.tool_uses)).toEqual([]);
  });

  it('returns empty array for unknown conversation_id', () => {
    expect(getConversationTurns('no-such-id')).toEqual([]);
  });
});

describe('closeConversation', () => {
  it('sets ended_at and turn_count', () => {
    const conv = createConversation();
    closeConversation(conv.id, 5);
    const updated = getConversation(conv.id)!;
    expect(updated.turn_count).toBe(5);
    expect(updated.ended_at).toBeTruthy();
  });
});

describe('listConversations', () => {
  it('returns both conversations ordered by started_at DESC', () => {
    const a = createConversation();
    const b = createConversation();
    const list = listConversations();
    expect(list.length).toBe(2);
    const ids = list.map((c) => c.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('respects the limit parameter', () => {
    createConversation();
    createConversation();
    createConversation();
    expect(listConversations(2).length).toBe(2);
  });
});

describe('deleteConversationsBefore', () => {
  it('deletes matching rows and returns count', () => {
    // Create a conversation then manually backdate it via a raw date string
    const conv = createConversation();
    closeConversation(conv.id, 1);

    // The conversation was just created (today), so deleting before yesterday should not touch it
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const deleted = deleteConversationsBefore(yesterday);
    expect(deleted).toBe(0);
    expect(getConversation(conv.id)).not.toBeNull();
  });

  it('deletes conversations before the given date', () => {
    const conv = createConversation();
    closeConversation(conv.id, 1);

    // Deleting before tomorrow should catch everything created today
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const deleted = deleteConversationsBefore(tomorrow);
    expect(deleted).toBe(1);
    expect(getConversation(conv.id)).toBeNull();
  });
});
