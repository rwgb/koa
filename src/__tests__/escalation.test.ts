import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';

vi.mock('../channels/router.js', () => ({
  routeResponse: vi.fn().mockResolvedValue(undefined),
}));

import { computeLevel, EscalationScheduler } from '../notifications/escalation.js';
import { routeResponse } from '../channels/router.js';
import { getDb, closeDb, createProject, createTask, logNotification } from '../db/index.js';

const routeResponseMock = vi.mocked(routeResponse);

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-esc-'));
  process.env['KOA_HOME'] = tmpDir;
  routeResponseMock.mockClear();
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
  vi.restoreAllMocks();
});

// ── computeLevel ──────────────────────────────────────────────────────────────

describe('computeLevel()', () => {
  const h = (hours: number) => Date.now() + hours * 60 * 60 * 1000;

  it('returns null when more than 48h out', () => {
    expect(computeLevel(new Date(h(49)).toISOString(), Date.now())).toBeNull();
  });

  it('returns null at exactly 48h out', () => {
    expect(computeLevel(new Date(h(48.001)).toISOString(), Date.now())).toBeNull();
  });

  it('returns due-tomorrow for 24–48h window', () => {
    expect(computeLevel(new Date(h(36)).toISOString(), Date.now())).toBe('due-tomorrow');
    expect(computeLevel(new Date(h(25)).toISOString(), Date.now())).toBe('due-tomorrow');
  });

  it('returns due-tomorrow at exactly 48h', () => {
    expect(computeLevel(new Date(h(48)).toISOString(), Date.now())).toBe('due-tomorrow');
  });

  it('returns 24h for 8–24h window', () => {
    expect(computeLevel(new Date(h(12)).toISOString(), Date.now())).toBe('24h');
    expect(computeLevel(new Date(h(9)).toISOString(), Date.now())).toBe('24h');
  });

  it('returns 24h at exactly 24h', () => {
    expect(computeLevel(new Date(h(24)).toISOString(), Date.now())).toBe('24h');
  });

  it('returns 8h for 0–8h window', () => {
    expect(computeLevel(new Date(h(4)).toISOString(), Date.now())).toBe('8h');
    expect(computeLevel(new Date(h(0.5)).toISOString(), Date.now())).toBe('8h');
  });

  it('returns 8h at exactly 8h', () => {
    expect(computeLevel(new Date(h(8)).toISOString(), Date.now())).toBe('8h');
  });

  it('returns overdue when deadline has passed', () => {
    expect(computeLevel(new Date(h(-1)).toISOString(), Date.now())).toBe('overdue');
    expect(computeLevel(new Date(h(-48)).toISOString(), Date.now())).toBe('overdue');
  });
});

// ── EscalationScheduler.tick() ────────────────────────────────────────────────

function setupProject() {
  const db = getDb();
  void db; // ensure migrations run
  const project = createProject('Test', 'test');
  return project;
}

describe('EscalationScheduler.tick()', () => {
  it('fires notification on first encounter of a level', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(); // 4h → '8h'
    createTask(project.id, 'Deadline task', { deadline });

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).toHaveBeenCalledOnce();
    expect(routeResponseMock).toHaveBeenCalledWith(
      'escalation',
      expect.stringContaining('Due in <8h'),
      'Deadline task',
      { critical: true },
    );
  });

  it('does not re-fire same level within 1 hour', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const task = createTask(project.id, 'Dedup task', { deadline });

    logNotification(task.id, '8h', 'ntfy');

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).not.toHaveBeenCalled();
  });

  it('re-fires after 1 hour has elapsed', async () => {
    vi.useFakeTimers();
    const project = setupProject();
    const now = Date.now();
    const deadline = new Date(now + 4 * 60 * 60 * 1000).toISOString();
    const task = createTask(project.id, 'Retry task', { deadline });

    // Log a notification from 2 hours ago
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    getDb()
      .prepare(`INSERT INTO notification_log (task_id, escalation_level, channel, sent_at) VALUES (?, ?, ?, ?)`)
      .run(task.id, '8h', 'ntfy', twoHoursAgo);

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('does not fire for done tasks', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const task = createTask(project.id, 'Done task', { deadline });
    const { updateTask } = await import('../db/index.js');
    updateTask(task.id, { status: 'done' });

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).not.toHaveBeenCalled();
  });

  it('does not fire for cancelled tasks', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const task = createTask(project.id, 'Cancelled task', { deadline });
    const { updateTask } = await import('../db/index.js');
    updateTask(task.id, { status: 'cancelled' });

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).not.toHaveBeenCalled();
  });

  it('does not fire for tasks without a deadline', async () => {
    const project = setupProject();
    createTask(project.id, 'No deadline task');

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).not.toHaveBeenCalled();
  });

  it('does not fire for tasks too far out', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72h
    createTask(project.id, 'Far future task', { deadline });

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).not.toHaveBeenCalled();
  });

  it('sends critical:true for 8h level', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    createTask(project.id, '8h task', { deadline });

    await new EscalationScheduler().tick();

    expect(routeResponseMock).toHaveBeenCalledWith(
      'escalation', expect.any(String), expect.any(String), { critical: true },
    );
  });

  it('sends critical:true for overdue level', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    createTask(project.id, 'Overdue task', { deadline });

    await new EscalationScheduler().tick();

    expect(routeResponseMock).toHaveBeenCalledWith(
      'escalation', expect.any(String), expect.any(String), { critical: true },
    );
  });

  it('sends critical:false for due-tomorrow level', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    createTask(project.id, 'Due tomorrow task', { deadline });

    await new EscalationScheduler().tick();

    expect(routeResponseMock).toHaveBeenCalledWith(
      'escalation', expect.any(String), expect.any(String), { critical: false },
    );
  });

  it('sends critical:false for 24h level', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    createTask(project.id, '24h task', { deadline });

    await new EscalationScheduler().tick();

    expect(routeResponseMock).toHaveBeenCalledWith(
      'escalation', expect.any(String), expect.any(String), { critical: false },
    );
  });

  it('does not fire when escalation is disabled', async () => {
    const project = setupProject();
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    createTask(project.id, 'Disabled task', { deadline });

    // Write escalation config disabling it
    const notifPath = path.join(tmpDir, '.koa', 'notifications.json');
    fs.mkdirSync(path.dirname(notifPath), { recursive: true });
    fs.writeFileSync(notifPath, JSON.stringify({ rules: [], quietHours: { enabled: false, from: '22:00', to: '08:00' }, escalation: { enabled: false } }));

    const scheduler = new EscalationScheduler();
    await scheduler.tick();

    expect(routeResponseMock).not.toHaveBeenCalled();
  });
});
