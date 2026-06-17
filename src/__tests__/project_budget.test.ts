import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import {
  closeDb,
  createProject,
  updateProject,
  getProjectBudget,
} from '../db/index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-budget-'));
  process.env['KOA_HOME'] = tmpDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('getProjectBudget()', () => {
  it('returns null for a project with no budget', () => {
    const project = createProject('Test Project');
    expect(getProjectBudget(project.id)).toBeNull();
  });

  it('returns the budget when set', () => {
    const project = createProject('Budget Project');
    updateProject(project.id, { budget_usd: 5.00 });
    expect(getProjectBudget(project.id)).toBe(5.00);
  });
});

describe('updateProject() budget_usd', () => {
  it('can set budget_usd on a project', () => {
    const project = createProject('Funded Project');
    const updated = updateProject(project.id, { budget_usd: 10.50 });
    expect(updated.budget_usd).toBe(10.50);
    expect(getProjectBudget(project.id)).toBe(10.50);
  });

  it('can clear budget_usd by setting null', () => {
    const project = createProject('Clearable Project');
    updateProject(project.id, { budget_usd: 3.00 });
    expect(getProjectBudget(project.id)).toBe(3.00);

    updateProject(project.id, { budget_usd: null });
    expect(getProjectBudget(project.id)).toBeNull();
  });
});
