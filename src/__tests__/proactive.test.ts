import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  detectBlockedTasks,
  detectStalledTasks,
  detectOverdueTasks,
  buildProactiveAlerts,
} from '../analytics/proactive.js';
import { createProject, createTask, updateTask, closeDb } from '../db/index.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-proactive-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('detectBlockedTasks', () => {
  it('returns null when no tasks are blocked', () => {
    expect(detectBlockedTasks(3)).toBeNull();
  });

  it('returns null when blocked task was updated recently', () => {
    const p = createProject('pa-blocked-recent');
    const t = createTask(p.id, 'New block');
    updateTask(t.id, { status: 'blocked' });

    expect(detectBlockedTasks(3)).toBeNull();
  });

  it('detects a recently blocked task when minDays=0', () => {
    const p = createProject('pa-blocked-zero');
    const t = createTask(p.id, 'Blocked zero');
    updateTask(t.id, { status: 'blocked' });

    const alert = detectBlockedTasks(0);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('blocked');
    expect(alert!.tasks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('detectStalledTasks', () => {
  it('returns null when no tasks are in_progress', () => {
    expect(detectStalledTasks(5)).toBeNull();
  });

  it('returns null for recently updated in_progress task', () => {
    const p = createProject('pa-stalled-recent');
    const t = createTask(p.id, 'Active task');
    updateTask(t.id, { status: 'in_progress' });

    expect(detectStalledTasks(5)).toBeNull();
  });

  it('detects stalled task when minDays=0', () => {
    const p = createProject('pa-stalled-zero');
    const t = createTask(p.id, 'Stalled zero');
    updateTask(t.id, { status: 'in_progress' });

    const alert = detectStalledTasks(0);
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('stalled');
  });
});

describe('detectOverdueTasks', () => {
  it('returns null when no tasks are overdue', () => {
    expect(detectOverdueTasks()).toBeNull();
  });

  it('detects tasks with a past deadline', () => {
    const p = createProject('pa-overdue');
    const pastDeadline = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    createTask(p.id, 'Overdue task', { deadline: pastDeadline });

    const alert = detectOverdueTasks();
    expect(alert).not.toBeNull();
    expect(alert!.type).toBe('overdue');
    expect(alert!.tasks.some((t) => t.deadline === pastDeadline)).toBe(true);
  });

  it('ignores done tasks even with past deadlines', () => {
    const p = createProject('pa-overdue-done');
    const pastDeadline = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const t = createTask(p.id, 'Done overdue', { deadline: pastDeadline });
    updateTask(t.id, { status: 'done' });

    expect(detectOverdueTasks()).toBeNull();
  });

  it('ignores cancelled tasks even with past deadlines', () => {
    const p = createProject('pa-overdue-cancelled');
    const pastDeadline = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const t = createTask(p.id, 'Cancelled overdue', { deadline: pastDeadline });
    updateTask(t.id, { status: 'cancelled' });

    expect(detectOverdueTasks()).toBeNull();
  });
});

describe('buildProactiveAlerts', () => {
  it('returns an empty array on a clean DB', () => {
    const alerts = buildProactiveAlerts();
    expect(Array.isArray(alerts)).toBe(true);
    expect(alerts.length).toBe(0);
  });

  it('includes an overdue alert when there is an overdue task', () => {
    const p = createProject('pa-combined');
    const pastDeadline = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    createTask(p.id, 'Past due', { deadline: pastDeadline });

    const alerts = buildProactiveAlerts();
    expect(alerts.some((a) => a.type === 'overdue')).toBe(true);
  });
});
