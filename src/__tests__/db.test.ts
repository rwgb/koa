import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {
  closeDb,
  createProject, getProject, getProjectBySlug, listProjects, updateProject, deleteProject,
  createTask, getTask, listTasks, updateTask, deleteTask,
  addDependency, removeDependency, getTaskDependencies,
  getNextTasks,
  createDecision, listDecisions,
  searchTasks,
  generateStateFromDb,
} from '../db/index.js';
import { bootstrapFromProjectMemory } from '../db/first-run.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-db-test-'));
  process.env['KOA_HOME'] = tempDir;
});

afterEach(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env['KOA_HOME'];
});

describe('DB: project CRUD', () => {
  it('createProject returns project with expected fields', () => {
    const p = createProject('Test Project', 'A description');
    expect(p.name).toBe('Test Project');
    expect(p.description).toBe('A description');
    expect(p.status).toBe('active');
    expect(p.slug).toBe('test-project');
    expect(p.id).toBeTruthy();
    expect(p.created_at).toBeTruthy();
  });

  it('getProject returns the created project by id', () => {
    const p = createProject('Alpha');
    expect(getProject(p.id)?.name).toBe('Alpha');
  });

  it('getProject returns null for unknown id', () => {
    expect(getProject('does-not-exist')).toBeNull();
  });

  it('getProjectBySlug returns by slug', () => {
    createProject('Beta Proj');
    expect(getProjectBySlug('beta-proj')?.name).toBe('Beta Proj');
  });

  it('listProjects returns all active projects', () => {
    createProject('P1');
    createProject('P2');
    expect(listProjects().length).toBe(2);
  });

  it('updateProject updates name and status', () => {
    const p = createProject('Old Name');
    updateProject(p.id, { name: 'New Name', status: 'done' });
    const updated = getProject(p.id);
    expect(updated?.name).toBe('New Name');
    expect(updated?.status).toBe('done');
  });

  it('deleteProject archives the project', () => {
    const p = createProject('To Archive');
    deleteProject(p.id);
    expect(getProject(p.id)?.status).toBe('archived');
  });

  it('throws on duplicate slug', () => {
    createProject('Unique');
    expect(() => createProject('Unique')).toThrow();
  });
});

describe('DB: task CRUD', () => {
  it('createTask returns task with correct id format and defaults', () => {
    const p = createProject('My Proj');
    const t = createTask(p.id, 'First task');
    expect(t.title).toBe('First task');
    expect(t.status).toBe('todo');
    expect(t.priority).toBe(3);
    expect(t.id).toMatch(/^my-proj-task-\d+-\d+$/);
    expect(t.tags).toEqual([]);
  });

  it('getTask returns task by id', () => {
    const p = createProject('Proj');
    const t = createTask(p.id, 'Find me');
    expect(getTask(t.id)?.title).toBe('Find me');
  });

  it('getTask returns null for unknown id', () => {
    expect(getTask('unknown')).toBeNull();
  });

  it('listTasks filters by projectId', () => {
    const p1 = createProject('P1');
    const p2 = createProject('P2');
    createTask(p1.id, 'T1');
    createTask(p1.id, 'T2');
    createTask(p2.id, 'T3');
    expect(listTasks({ projectId: p1.id }).length).toBe(2);
    expect(listTasks({ projectId: p2.id }).length).toBe(1);
  });

  it('listTasks filters by status', () => {
    const p = createProject('P');
    const t1 = createTask(p.id, 'Todo');
    const t2 = createTask(p.id, 'Done');
    updateTask(t2.id, { status: 'done' });
    expect(listTasks({ status: 'todo' }).length).toBe(1);
    expect(listTasks({ status: 'done' }).length).toBe(1);
    void t1;
  });

  it('updateTask updates all editable fields', () => {
    const p = createProject('P');
    const t = createTask(p.id, 'Original');
    updateTask(t.id, {
      title: 'Updated', status: 'in_progress', priority: 1,
      deadline: '2026-12-31', effort_hours: 4.5, tags: ['urgent', 'backend'],
    });
    const updated = getTask(t.id);
    expect(updated?.title).toBe('Updated');
    expect(updated?.status).toBe('in_progress');
    expect(updated?.priority).toBe(1);
    expect(updated?.deadline).toBe('2026-12-31');
    expect(updated?.effort_hours).toBe(4.5);
    expect(updated?.tags).toEqual(['urgent', 'backend']);
  });

  it('deleteTask removes the task', () => {
    const p = createProject('P');
    const t = createTask(p.id, 'Bye');
    deleteTask(t.id);
    expect(getTask(t.id)).toBeNull();
  });

  it('createTask stores and parses tags', () => {
    const p = createProject('P');
    const t = createTask(p.id, 'Tagged', { tags: ['alpha', 'beta'] });
    expect(getTask(t.id)?.tags).toEqual(['alpha', 'beta']);
  });
});

describe('DB: task dependencies', () => {
  it('addDependency and getTaskDependencies work correctly', () => {
    const p = createProject('P');
    const t1 = createTask(p.id, 'Prereq');
    const t2 = createTask(p.id, 'Blocker');
    const t3 = createTask(p.id, 'Main task');
    addDependency(t3.id, t1.id);
    addDependency(t3.id, t2.id);
    const deps = getTaskDependencies(t3.id);
    expect(deps.length).toBe(2);
    expect(deps.map(d => d.id).sort()).toEqual([t1.id, t2.id].sort());
  });

  it('removeDependency removes a specific dependency', () => {
    const p = createProject('P');
    const t1 = createTask(p.id, 'A');
    const t2 = createTask(p.id, 'B');
    addDependency(t2.id, t1.id);
    removeDependency(t2.id, t1.id);
    expect(getTaskDependencies(t2.id).length).toBe(0);
  });

  it('addDependency prevents direct cycles', () => {
    const p = createProject('P');
    const t1 = createTask(p.id, 'A');
    const t2 = createTask(p.id, 'B');
    addDependency(t1.id, t2.id);
    expect(() => addDependency(t2.id, t1.id)).toThrow();
  });
});

describe('DB: getNextTasks', () => {
  it('returns tasks with no incomplete dependencies', () => {
    const p = createProject('P');
    const prereq = createTask(p.id, 'Prereq');
    const blocked = createTask(p.id, 'Blocked by prereq');
    const free = createTask(p.id, 'No deps');
    addDependency(blocked.id, prereq.id);
    const next = getNextTasks(p.id);
    const ids = next.map(t => t.id);
    expect(ids).toContain(prereq.id);
    expect(ids).toContain(free.id);
    expect(ids).not.toContain(blocked.id);
  });

  it('includes previously-blocked task once its dependency is done', () => {
    const p = createProject('P');
    const prereq = createTask(p.id, 'Prereq');
    const blocked = createTask(p.id, 'Blocked');
    addDependency(blocked.id, prereq.id);
    updateTask(prereq.id, { status: 'done' });
    const next = getNextTasks(p.id);
    expect(next.map(t => t.id)).toContain(blocked.id);
  });

  it('respects the limit parameter', () => {
    const p = createProject('P');
    for (let i = 0; i < 5; i++) createTask(p.id, `Task ${i}`);
    expect(getNextTasks(p.id, 2).length).toBeLessThanOrEqual(2);
  });
});

describe('DB: search', () => {
  it('searchTasks finds tasks by title keyword', () => {
    const p = createProject('P');
    createTask(p.id, 'Fix login bug');
    createTask(p.id, 'Add dark mode');
    const results = searchTasks('login');
    expect(results.length).toBe(1);
    expect(results[0]?.title).toContain('login');
  });

  it('searchTasks returns empty for no match', () => {
    const p = createProject('P');
    createTask(p.id, 'Something else');
    expect(searchTasks('xyznonexistent').length).toBe(0);
  });
});

describe('DB: decisions', () => {
  it('createDecision and listDecisions work', () => {
    const p = createProject('P');
    createDecision(p.id, 'Use SQLite', {
      context: 'Need embedded db',
      chosen: 'SQLite',
      rationale: 'Simple and reliable',
      options: ['SQLite', 'PostgreSQL'],
    });
    const list = listDecisions();
    expect(list.length).toBe(1);
    expect(list[0]?.title).toBe('Use SQLite');
    expect(list[0]?.options).toEqual(['SQLite', 'PostgreSQL']);
  });

  it('listDecisions filters by projectId', () => {
    const p1 = createProject('P1');
    const p2 = createProject('P2');
    createDecision(p1.id, 'Decision A', { context: '', chosen: 'A', rationale: '' });
    createDecision(p2.id, 'Decision B', { context: '', chosen: 'B', rationale: '' });
    expect(listDecisions(p1.id).length).toBe(1);
    expect(listDecisions(p2.id).length).toBe(1);
  });
});

describe('DB: generateStateFromDb', () => {
  it('returns a markdown string with Projects section', () => {
    const p = createProject('My Project');
    createTask(p.id, 'Task One');
    const md = generateStateFromDb();
    expect(md).toContain('## Projects');
    expect(md).toContain('My Project');
  });

  it('includes task in output', () => {
    const p = createProject('Proj');
    createTask(p.id, 'Important task');
    const md = generateStateFromDb(p.id);
    expect(md).toContain('Important task');
  });
});

describe('first-run bootstrap', () => {
  it('imports unchecked tasks from STATE.md', async () => {
    const p = createProject('My Project');
    const stateMd = `
# State
- [ ] Fix the login bug
- [x] Already done
- [ ] Add dark mode
`;
    const result = await bootstrapFromProjectMemory(p.id, stateMd, null);
    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);
    const tasks = listTasks({ projectId: p.id });
    expect(tasks.map(t => t.title).sort()).toEqual(['Add dark mode', 'Fix the login bug'].sort());
  });

  it('imports from BACKLOG.md when STATE.md is null', async () => {
    const p = createProject('Proj');
    const backlogMd = `- [ ] Backlog task one
- [ ] Backlog task two`;
    const result = await bootstrapFromProjectMemory(p.id, null, backlogMd);
    expect(result.imported).toBe(2);
  });

  it('skips already-imported tasks (case-insensitive)', async () => {
    const p = createProject('Proj');
    createTask(p.id, 'Fix the login bug');
    const result = await bootstrapFromProjectMemory(p.id, '- [ ] Fix the login bug', null);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('handles null STATE.md and BACKLOG.md gracefully', async () => {
    const p = createProject('Empty');
    const result = await bootstrapFromProjectMemory(p.id, null, null);
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('deduplicates tasks across both files', async () => {
    const p = createProject('P');
    const stateMd = '- [ ] Shared task';
    const backlogMd = '- [ ] Shared task';
    const result = await bootstrapFromProjectMemory(p.id, stateMd, backlogMd);
    expect(result.imported).toBe(1);
    expect(listTasks({ projectId: p.id }).length).toBe(1);
  });
});
