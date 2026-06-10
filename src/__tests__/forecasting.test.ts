import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { computeForecast, buildForecastSummaryText } from '../analytics/forecasting.js';
import { createProject, createTask, updateTask, closeDb } from '../db/index.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-forecast-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('computeForecast', () => {
  it('returns globalTaskCount=0 on empty DB', () => {
    const result = computeForecast();
    expect(result.globalTaskCount).toBe(0);
    expect(result.globalRatio).toBeNull();
  });

  it('ignores done tasks with only effort_hours (no actual_hours)', () => {
    const p = createProject('fc-only-estimate');
    const t = createTask(p.id, 'Half measured', { effortHours: 4 });
    updateTask(t.id, { status: 'done' });

    const result = computeForecast();
    expect(result.globalTaskCount).toBe(0);
  });

  it('computes ratio correctly for a single task', () => {
    const p = createProject('fc-single');
    const t = createTask(p.id, 'Measured task', { effortHours: 4 });
    updateTask(t.id, { status: 'done', actual_hours: 6 });

    const result = computeForecast();
    expect(result.globalTaskCount).toBe(1);
    expect(result.globalEstimated).toBeCloseTo(4);
    expect(result.globalActual).toBeCloseTo(6);
    expect(result.globalRatio).toBeCloseTo(1.5);
  });

  it('aggregates multiple tasks across projects', () => {
    const p1 = createProject('fc-multi-1');
    const p2 = createProject('fc-multi-2');
    const t1 = createTask(p1.id, 'T1', { effortHours: 2 });
    const t2 = createTask(p2.id, 'T2', { effortHours: 4 });
    updateTask(t1.id, { status: 'done', actual_hours: 2 });
    updateTask(t2.id, { status: 'done', actual_hours: 4 });

    const result = computeForecast();
    expect(result.globalTaskCount).toBe(2);
    expect(result.globalRatio).toBeCloseTo(1.0);
  });

  it('excludes tasks that are not done', () => {
    const p = createProject('fc-not-done');
    const t = createTask(p.id, 'In progress', { effortHours: 3 });
    updateTask(t.id, { status: 'in_progress', actual_hours: 1 });

    const result = computeForecast();
    expect(result.globalTaskCount).toBe(0);
  });

  it('filters by projectId when provided', () => {
    const p1 = createProject('fc-filter-1');
    const p2 = createProject('fc-filter-2');
    const t1 = createTask(p1.id, 'T1', { effortHours: 2 });
    const t2 = createTask(p2.id, 'T2', { effortHours: 4 });
    updateTask(t1.id, { status: 'done', actual_hours: 3 });
    updateTask(t2.id, { status: 'done', actual_hours: 8 });

    const result = computeForecast(p1.id);
    expect(result.globalTaskCount).toBe(1);
    expect(result.globalEstimated).toBeCloseTo(2);
  });
});

describe('buildForecastSummaryText', () => {
  it('returns no-data message when globalTaskCount is 0', () => {
    const summary = computeForecast();
    const text = buildForecastSummaryText(summary);
    expect(text).toContain('No forecasting data');
  });

  it('includes over/under direction in summary text', () => {
    const p = createProject('fc-text');
    const t = createTask(p.id, 'Over estimate', { effortHours: 2 });
    updateTask(t.id, { status: 'done', actual_hours: 4 });

    const summary = computeForecast();
    const text = buildForecastSummaryText(summary);
    expect(text).toContain('over');
  });
});
