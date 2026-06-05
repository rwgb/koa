import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  closeDb,
  createDelegation,
  listDelegations,
  getDelegation,
  updateDelegation,
  deleteDelegation,
} from '../db/index.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-delegations-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('Delegation CRUD', () => {
  it('listDelegations returns empty array initially', () => {
    expect(listDelegations()).toEqual([]);
  });

  it('createDelegation creates and returns a delegation', () => {
    const d = createDelegation({ pattern: 'review prs', action: 'Review open PRs', schedule: 'daily' });
    expect(d.id).toBeTruthy();
    expect(d.pattern).toBe('review prs');
    expect(d.action).toBe('Review open PRs');
    expect(d.schedule).toBe('daily');
    expect(d.enabled).toBe(1);
    expect(d.last_run).toBeNull();
  });

  it('listDelegations returns created delegation', () => {
    createDelegation({ pattern: '', action: 'Do something', schedule: 'weekly' });
    const list = listDelegations();
    expect(list).toHaveLength(1);
    expect(list[0]!.action).toBe('Do something');
  });

  it('getDelegation returns null for unknown id', () => {
    expect(getDelegation('nonexistent')).toBeNull();
  });

  it('getDelegation returns the delegation by id', () => {
    const d = createDelegation({ pattern: '', action: 'Sync repos', schedule: 'daily' });
    const found = getDelegation(d.id);
    expect(found).not.toBeNull();
    expect(found!.action).toBe('Sync repos');
  });

  it('updateDelegation updates fields', () => {
    const d = createDelegation({ pattern: '', action: 'Old action', schedule: 'daily' });
    const updated = updateDelegation(d.id, { action: 'New action', schedule: 'weekly' });
    expect(updated!.action).toBe('New action');
    expect(updated!.schedule).toBe('weekly');
  });

  it('updateDelegation can disable a delegation', () => {
    const d = createDelegation({ pattern: '', action: 'Some action', schedule: 'daily' });
    const updated = updateDelegation(d.id, { enabled: 0 });
    expect(updated!.enabled).toBe(0);
  });

  it('updateDelegation returns null for unknown id', () => {
    const result = updateDelegation('nonexistent', { action: 'x' });
    expect(result).toBeNull();
  });

  it('deleteDelegation removes the delegation', () => {
    const d = createDelegation({ pattern: '', action: 'Delete me', schedule: 'daily' });
    deleteDelegation(d.id);
    expect(getDelegation(d.id)).toBeNull();
    expect(listDelegations()).toHaveLength(0);
  });

  it('createDelegation with empty pattern stores empty string', () => {
    const d = createDelegation({ pattern: '', action: 'Action', schedule: 'monthly' });
    expect(d.pattern).toBe('');
  });

  it('updateDelegation sets last_run', () => {
    const d = createDelegation({ pattern: '', action: 'Run me', schedule: 'daily' });
    const ts = new Date().toISOString();
    const updated = updateDelegation(d.id, { last_run: ts });
    expect(updated!.last_run).toBe(ts);
  });
});
