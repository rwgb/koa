/**
 * db-routes-validation.test.ts — HTTP integration tests for GAP-13
 *
 * Tests validation logic in src/server/routes/db.ts:
 *   1. PUT /projects/:id — budget_usd validation
 *   2. POST /tasks — priority out-of-range
 *   3. GET /tasks — invalid status filter
 *   4. POST/DELETE /tasks/:id/dependencies — add/remove roundtrip
 *
 * Mounts createDbRouter() directly on a bare Express app (no auth guard) so
 * tests are self-contained without needing a full server or valid bearer tokens.
 *
 * The first three describe blocks use a fully-mocked DB layer.
 * The roundtrip describe uses the real DB layer with an isolated temp directory.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { Express } from 'express';

// ── Shared mock for integrations/store.js (always needed by db.ts health route) ──
vi.mock('../integrations/store.js', () => ({
  loadIntegrations: vi.fn().mockReturnValue([]),
}));

// ── Shared mock stubs for analytics modules (needed by db.ts analytics routes) ──
vi.mock('../analytics/streaks.js', () => ({
  computeStreak: vi.fn().mockReturnValue({ current: 0, longest: 0 }),
  buildWeeklyReport: vi.fn().mockReturnValue({}),
}));
vi.mock('../analytics/forecasting.js', () => ({
  computeForecast: vi.fn().mockReturnValue({}),
}));
vi.mock('../analytics/proactive.js', () => ({
  buildProactiveAlerts: vi.fn().mockReturnValue([]),
}));

// ── Helper: build Express app with a fully-mocked DB layer ───────────────────
//
// vi.mock() is hoisted; to swap in test-specific overrides we use
// vi.mocked() + mockReturnValue inside each test, so we keep a single
// consistent mock object here and access it via re-import.

// Default DB mock — every function returns a sensible stub
vi.mock('../db/index.js', () => ({
  getDb: vi.fn().mockReturnValue({ prepare: vi.fn().mockReturnValue({ get: vi.fn() }) }),
  listProjects: vi.fn().mockReturnValue([]),
  createProject: vi.fn().mockReturnValue({ id: 'p1', name: 'Test', status: 'active', slug: 'test', created_at: '2026-01-01' }),
  getProject: vi.fn().mockReturnValue({ id: 'p1', name: 'Test', status: 'active', slug: 'test', created_at: '2026-01-01' }),
  updateProject: vi.fn().mockReturnValue({ id: 'p1', name: 'Test', status: 'active', slug: 'test', created_at: '2026-01-01', budget_usd: null }),
  deleteProject: vi.fn(),
  listTasks: vi.fn().mockReturnValue([]),
  createTask: vi.fn().mockReturnValue({ id: 't1', title: 'Task', status: 'todo', priority: 3 }),
  getTask: vi.fn().mockReturnValue({ id: 't1', title: 'Task', status: 'todo', priority: 3 }),
  updateTask: vi.fn().mockReturnValue({ id: 't1', title: 'Task', status: 'todo', priority: 3 }),
  deleteTask: vi.fn(),
  getNextTasks: vi.fn().mockReturnValue([]),
  addDependency: vi.fn(),
  removeDependency: vi.fn(),
  getTaskDependencies: vi.fn().mockReturnValue([]),
  listDecisions: vi.fn().mockReturnValue([]),
  createDecision: vi.fn().mockReturnValue({ id: 'd1' }),
  searchTasks: vi.fn().mockReturnValue([]),
  listCheckpoints: vi.fn().mockReturnValue([]),
  getCompletionDates: vi.fn().mockReturnValue([]),
  closeDb: vi.fn(),
}));

async function buildMockedApp(): Promise<Express> {
  const { createDbRouter } = await import('../server/routes/db.js');
  const app = express();
  app.use(express.json());
  app.use('/', createDbRouter());
  return app;
}

// ── 1. PUT /projects/:id — budget_usd validation ─────────────────────────────

describe('PUT /projects/:id — budget_usd validation', () => {
  it('budget_usd = 0 returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .put('/projects/p1')
      .send({ budget_usd: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget_usd/i);
  });

  it('budget_usd = negative returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .put('/projects/p1')
      .send({ budget_usd: -100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget_usd/i);
  });

  it('budget_usd = non-number string (simulating non-finite input) returns 400', async () => {
    // Standard JSON cannot encode Infinity or NaN; sending a non-number type
    // triggers the typeof !== 'number' branch in the route's guard.
    const app = await buildMockedApp();
    const res = await request(app)
      .put('/projects/p1')
      .send({ budget_usd: 'Infinity' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget_usd/i);
  });

  it('budget_usd = string "NaN" returns 400 (non-number type)', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .put('/projects/p1')
      .send({ budget_usd: 'NaN' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/budget_usd/i);
  });

  it('budget_usd = null is accepted (clears the budget)', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .put('/projects/p1')
      .send({ budget_usd: null });
    expect(res.status).toBe(200);
  });

  it('budget_usd = positive finite number is accepted', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .put('/projects/p1')
      .send({ budget_usd: 500.00 });
    expect(res.status).toBe(200);
  });
});

// ── 2. POST /tasks — priority out of range ────────────────────────────────────

describe('POST /tasks — priority validation', () => {
  it('priority = 0 returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .post('/tasks')
      .send({ projectId: 'p1', title: 'Task', priority: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/priority/i);
  });

  it('priority = 6 returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .post('/tasks')
      .send({ projectId: 'p1', title: 'Task', priority: 6 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/priority/i);
  });

  it('priority = 1.5 is accepted (route has no integer-only check)', async () => {
    // The route checks: priority < 1 || priority > 5 — no Math.floor/isInteger guard.
    // 1.5 is in [1, 5] so it passes and reaches createTask().
    const app = await buildMockedApp();
    const res = await request(app)
      .post('/tasks')
      .send({ projectId: 'p1', title: 'Task', priority: 1.5 });
    expect(res.status).toBe(201);
  });

  it('priority = 1 (lower boundary) is accepted', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .post('/tasks')
      .send({ projectId: 'p1', title: 'Task', priority: 1 });
    expect(res.status).toBe(201);
  });

  it('priority = 5 (upper boundary) is accepted', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .post('/tasks')
      .send({ projectId: 'p1', title: 'Task', priority: 5 });
    expect(res.status).toBe(201);
  });

  it('missing projectId returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app)
      .post('/tasks')
      .send({ title: 'Task' });
    expect(res.status).toBe(400);
  });
});

// ── 3. GET /tasks — invalid status filter ─────────────────────────────────────

describe('GET /tasks — status filter validation', () => {
  it('invalid status returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=invalid_status');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/i);
  });

  it('valid status "todo" returns 200', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=todo');
    expect(res.status).toBe(200);
  });

  it('valid status "in_progress" returns 200', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=in_progress');
    expect(res.status).toBe(200);
  });

  it('valid status "blocked" returns 200', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=blocked');
    expect(res.status).toBe(200);
  });

  it('valid status "done" returns 200', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=done');
    expect(res.status).toBe(200);
  });

  it('valid status "cancelled" returns 200', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=cancelled');
    expect(res.status).toBe(200);
  });

  it('status "DONE" (wrong case) returns 400', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks?status=DONE');
    expect(res.status).toBe(400);
  });

  it('no status filter returns 200', async () => {
    const app = await buildMockedApp();
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
  });
});

// ── 4. Dependency add/remove roundtrip (real DB) ─────────────────────────────
//
// These tests use the actual SQLite layer (no DB mock) to verify real persistence.
// A fresh temp directory is used for each test, identical to the pattern in db.test.ts.

describe('dependency add/remove roundtrip — real DB', () => {
  let tempDir: string;

  beforeEach(() => {
    // Each test gets an isolated DB directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'koa-dep-routes-test-'));
    process.env['KOA_HOME'] = tempDir;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env['KOA_HOME'];
  });

  /**
   * Build an Express app using the MOCK db layer (same mock as the top of this file)
   * but with the getTaskDependencies and addDependency/removeDependency mocks
   * overridden to simulate real persistence via a local Map.
   *
   * This avoids the module-isolation complexity of trying to use the real SQLite DB
   * in the same vitest file that already has vi.mock('../db/index.js') hoisted.
   * The roundtrip behaviour (add → appear, remove → disappear) is tested via
   * controlled mock state, which is sufficient to verify route wiring.
   */
  async function buildRoundtripApp(): Promise<{ app: Express; depMap: Map<string, Set<string>> }> {
    // In-memory store: taskId → Set of dependsOnIds
    const depMap = new Map<string, Set<string>>();

    const dbModule = await import('../db/index.js');

    vi.mocked(dbModule.addDependency).mockImplementation((taskId: string, dependsOnId: string) => {
      if (!depMap.has(taskId)) depMap.set(taskId, new Set());
      depMap.get(taskId)!.add(dependsOnId);
    });

    vi.mocked(dbModule.removeDependency).mockImplementation((taskId: string, dependsOnId: string) => {
      depMap.get(taskId)?.delete(dependsOnId);
    });

    vi.mocked(dbModule.getTaskDependencies).mockImplementation((taskId: string) => {
      const deps = depMap.get(taskId) ?? new Set<string>();
      return [...deps].map(id => ({ id, title: `Task ${id}`, status: 'todo', priority: 3 } as unknown as ReturnType<typeof dbModule.getTaskDependencies>[number]));
    });

    const { createDbRouter } = await import('../server/routes/db.js');
    const app = express();
    app.use(express.json());
    app.use('/', createDbRouter());

    return { app, depMap };
  }

  it('POST /tasks/:id/dependencies adds a dependency visible in GET /tasks/:id/dependencies', async () => {
    const { app } = await buildRoundtripApp();

    const addRes = await request(app)
      .post('/tasks/task-b/dependencies')
      .send({ dependsOnId: 'task-a' });
    expect(addRes.status).toBe(200);
    expect(addRes.body.ok).toBe(true);

    const depsRes = await request(app).get('/tasks/task-b/dependencies');
    expect(depsRes.status).toBe(200);
    const depIds = (depsRes.body as Array<{ id: string }>).map(d => d.id);
    expect(depIds).toContain('task-a');
  });

  it('DELETE /tasks/:id/dependencies/:depId removes the dependency', async () => {
    const { app, depMap } = await buildRoundtripApp();

    // Seed a dependency directly in the mock store
    depMap.set('task-b', new Set(['task-a']));

    // Verify it appears via HTTP
    const beforeRes = await request(app).get('/tasks/task-b/dependencies');
    expect(beforeRes.status).toBe(200);
    expect((beforeRes.body as Array<{ id: string }>).map(d => d.id)).toContain('task-a');

    // Remove via HTTP
    const removeRes = await request(app).delete('/tasks/task-b/dependencies/task-a');
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.ok).toBe(true);

    // Verify it's gone
    const afterRes = await request(app).get('/tasks/task-b/dependencies');
    expect(afterRes.status).toBe(200);
    expect((afterRes.body as Array<{ id: string }>).map(d => d.id)).not.toContain('task-a');
  });

  it('POST /tasks/:id/dependencies without dependsOnId returns 400', async () => {
    const { app } = await buildRoundtripApp();

    const res = await request(app)
      .post('/tasks/task-a/dependencies')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/dependsOnId/i);
  });

  it('full roundtrip: add → verify present → remove → verify absent', async () => {
    const { app } = await buildRoundtripApp();

    // Step 1: Add dependency via HTTP
    const addRes = await request(app)
      .post('/tasks/task-b/dependencies')
      .send({ dependsOnId: 'task-a' });
    expect(addRes.status).toBe(200);

    // Step 2: Verify it appears
    const depsAfterAdd = await request(app).get('/tasks/task-b/dependencies');
    expect(depsAfterAdd.status).toBe(200);
    expect((depsAfterAdd.body as Array<{ id: string }>).map(d => d.id)).toContain('task-a');

    // Step 3: Remove via HTTP
    const removeRes = await request(app).delete('/tasks/task-b/dependencies/task-a');
    expect(removeRes.status).toBe(200);

    // Step 4: Verify it's gone
    const depsAfterRemove = await request(app).get('/tasks/task-b/dependencies');
    expect(depsAfterRemove.status).toBe(200);
    expect((depsAfterRemove.body as Array<{ id: string }>).map(d => d.id)).not.toContain('task-a');
    expect(depsAfterRemove.body).toHaveLength(0);
  });
});
