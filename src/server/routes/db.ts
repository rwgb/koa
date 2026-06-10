import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getDb,
  listProjects, createProject, getProject, updateProject, deleteProject,
  listTasks, createTask, getTask, updateTask, deleteTask, getNextTasks,
  addDependency, removeDependency, getTaskDependencies,
  listDecisions, createDecision,
  searchTasks,
  listCheckpoints,
  getCompletionDates,
} from '../../db/index.js';
import { loadIntegrations } from '../../integrations/store.js';
import { computeStreak, buildWeeklyReport } from '../../analytics/streaks.js';
import { computeForecast } from '../../analytics/forecasting.js';
import { buildProactiveAlerts } from '../../analytics/proactive.js';
import { dbError } from '../utils.js';

// Validation constants shared across project/task routes
const VALID_PROJECT_STATUS = new Set(['active', 'archived', 'done']);
const VALID_TASK_STATUS = new Set(['todo', 'in_progress', 'blocked', 'done', 'cancelled']);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _appVersion = '0.0.0';
try {
  const pkgPath = path.join(__dirname, '../../../../package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
  _appVersion = pkg.version ?? '0.0.0';
} catch { /* non-fatal */ }

function getChannelStatuses(): Record<string, 'connected' | 'not_configured'> {
  const integrations = loadIntegrations();
  const has = (type: string) =>
    integrations.some(i => i.type === type && i.status === 'connected')
      ? 'connected' as const
      : 'not_configured' as const;
  return { gmail: has('gmail'), sms: has('twilio'), slack: has('slack') };
}

export function createDbRouter(): Router {
  const router = Router();

  // ── Health ────────────────────────────────────────────────────────────────────

  router.get('/channels/status', (_req, res) => {
    res.json(getChannelStatuses());
  });

  router.get('/health', (_req, res) => {
    let dbStatus: 'ok' | 'error' = 'ok';
    try { getDb().prepare('SELECT 1').get(); } catch { dbStatus = 'error'; }
    res.json({
      status: 'ok',
      db: dbStatus,
      channels: getChannelStatuses(),
      uptime: process.uptime(),
      version: _appVersion,
    });
  });

  // ── Projects ──────────────────────────────────────────────────────────────────

  router.get('/projects', (_req, res) => {
    try { res.json(listProjects()); } catch (e) { dbError(res, e); }
  });

  router.post('/projects', (req, res) => {
    try {
      const { name, description, slug } = req.body as { name?: string; description?: string; slug?: string };
      if (!name) { res.status(400).json({ error: 'name required' }); return; }
      res.status(201).json({ project: createProject(name, description, slug) });
    } catch (e) { dbError(res, e); }
  });

  router.get('/projects/:id', (req, res) => {
    try {
      const id = (req.params as { id: string }).id;
      const p = getProject(id);
      if (!p) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ project: p });
    } catch (e) { dbError(res, e); }
  });

  router.put('/projects/:id', (req, res) => {
    try {
      const id = (req.params as { id: string }).id;
      const body = req.body as { name?: string; description?: string; status?: string; budget_usd?: unknown };
      if (body.status !== undefined && !VALID_PROJECT_STATUS.has(body.status)) {
        res.status(400).json({ error: `Invalid status — must be one of: ${[...VALID_PROJECT_STATUS].join(', ')}` });
        return;
      }
      if ('budget_usd' in body) {
        const bud = body.budget_usd;
        if (bud !== null && (typeof bud !== 'number' || !isFinite(bud) || bud <= 0)) {
          res.status(400).json({ error: 'budget_usd must be a positive finite number or null' });
          return;
        }
      }
      res.json({ project: updateProject(id, body as Parameters<typeof updateProject>[1]) });
    } catch (e) { dbError(res, e); }
  });

  router.delete('/projects/:id', (req, res) => {
    try {
      deleteProject((req.params as { id: string }).id);
      res.json({ ok: true });
    } catch (e) { dbError(res, e); }
  });

  // ── Tasks ─────────────────────────────────────────────────────────────────────

  router.get('/tasks/next', (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      const rawLimit = q['limit'] ? parseInt(q['limit'], 10) : 5;
      const limit = isNaN(rawLimit) ? 5 : Math.min(Math.max(1, rawLimit), 100);
      res.json(getNextTasks(q['projectId'], limit));
    } catch (e) { dbError(res, e); }
  });

  router.get('/tasks', (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      if (q['status'] && !VALID_TASK_STATUS.has(q['status'])) {
        res.status(400).json({ error: `Invalid status — must be one of: ${[...VALID_TASK_STATUS].join(', ')}` });
        return;
      }
      res.json(listTasks({
        ...(q['projectId'] ? { projectId: q['projectId'] } : {}),
        ...(q['status'] ? { status: q['status'] as Parameters<typeof listTasks>[0] extends { status?: infer S } ? S : never } : {}),
      }));
    } catch (e) { dbError(res, e); }
  });

  router.post('/tasks', (req, res) => {
    try {
      const { projectId, title, ...opts } = req.body as { projectId?: string; title?: string; description?: string; priority?: number; deadline?: string; effortHours?: number; tags?: string[] };
      if (!projectId || !title) { res.status(400).json({ error: 'projectId and title required' }); return; }
      if (opts.priority !== undefined && (typeof opts.priority !== 'number' || opts.priority < 1 || opts.priority > 5)) {
        res.status(400).json({ error: 'priority must be an integer 1–5' }); return;
      }
      if (opts.deadline !== undefined && opts.deadline !== null && !ISO_DATE_RE.test(opts.deadline)) {
        res.status(400).json({ error: 'deadline must be YYYY-MM-DD or null' }); return;
      }
      res.status(201).json({ task: createTask(projectId, title, opts) });
    } catch (e) { dbError(res, e); }
  });

  router.get('/tasks/:id', (req, res) => {
    try {
      const t = getTask((req.params as { id: string }).id);
      if (!t) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ task: t });
    } catch (e) { dbError(res, e); }
  });

  router.put('/tasks/:id', (req, res) => {
    try {
      const body = req.body as Parameters<typeof updateTask>[1] & { status?: string; priority?: number; deadline?: string };
      if (body.status !== undefined && !VALID_TASK_STATUS.has(body.status)) {
        res.status(400).json({ error: `Invalid status — must be one of: ${[...VALID_TASK_STATUS].join(', ')}` });
        return;
      }
      if (body.priority !== undefined && (typeof body.priority !== 'number' || body.priority < 1 || body.priority > 5)) {
        res.status(400).json({ error: 'priority must be an integer 1–5' }); return;
      }
      if (body.deadline !== undefined && body.deadline !== null && !ISO_DATE_RE.test(body.deadline)) {
        res.status(400).json({ error: 'deadline must be YYYY-MM-DD or null' }); return;
      }
      const ah = (body as { actual_hours?: unknown }).actual_hours;
      if (ah !== undefined && ah !== null && (typeof ah !== 'number' || ah < 0)) {
        res.status(400).json({ error: 'actual_hours must be a non-negative number or null' }); return;
      }
      res.json({ task: updateTask((req.params as { id: string }).id, body) });
    } catch (e) { dbError(res, e); }
  });

  router.delete('/tasks/:id', (req, res) => {
    try {
      deleteTask((req.params as { id: string }).id);
      res.json({ ok: true });
    } catch (e) { dbError(res, e); }
  });

  router.get('/tasks/:id/dependencies', (req, res) => {
    try { res.json(getTaskDependencies((req.params as { id: string }).id)); } catch (e) { dbError(res, e); }
  });

  router.post('/tasks/:id/dependencies', (req, res) => {
    try {
      const { dependsOnId } = req.body as { dependsOnId?: string };
      if (!dependsOnId) { res.status(400).json({ error: 'dependsOnId required' }); return; }
      addDependency((req.params as { id: string }).id, dependsOnId);
      res.json({ ok: true });
    } catch (e) { dbError(res, e); }
  });

  router.delete('/tasks/:id/dependencies/:depId', (req, res) => {
    try {
      const { id, depId } = req.params as { id: string; depId: string };
      removeDependency(id, depId);
      res.json({ ok: true });
    } catch (e) { dbError(res, e); }
  });

  // ── Decisions ─────────────────────────────────────────────────────────────────

  router.get('/decisions', (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      res.json(listDecisions(q['projectId']));
    } catch (e) { dbError(res, e); }
  });

  router.post('/decisions', (req, res) => {
    try {
      const { projectId, title, context, chosen, rationale, options } = req.body as { projectId?: string; title?: string; context?: string; chosen?: string; rationale?: string; options?: string[] };
      if (!projectId || !title || !chosen) { res.status(400).json({ error: 'projectId, title, chosen required' }); return; }
      const opts: Parameters<typeof createDecision>[2] = { context: context ?? '', chosen, rationale: rationale ?? '' };
      if (options !== undefined) opts.options = options;
      res.status(201).json({ decision: createDecision(projectId, title, opts) });
    } catch (e) { dbError(res, e); }
  });

  // ── Search ────────────────────────────────────────────────────────────────────

  router.get('/search', (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      if (!q['q']?.trim()) { res.json([]); return; }
      if (q['q'].length > 200) { res.status(400).json({ error: 'query too long (max 200 chars)' }); return; }
      res.json(searchTasks(q['q'], q['projectId']));
    } catch (e) { dbError(res, e); }
  });

  // ── Checkpoints ───────────────────────────────────────────────────────────────

  router.get('/checkpoints', (req, res) => {
    try {
      const q = req.query as Record<string, string>;
      res.json(listCheckpoints(q['projectId']));
    } catch (e) { dbError(res, e); }
  });

  // ── Analytics ─────────────────────────────────────────────────────────────────

  router.get('/analytics/streak', (_req, res) => {
    try {
      const dates = getCompletionDates();
      const streak = computeStreak(dates);
      res.json({ streak, totalCompletionDays: dates.length });
    } catch (e) { dbError(res, e); }
  });

  router.get('/analytics/weekly-report', (_req, res) => {
    try {
      const report = buildWeeklyReport();
      res.json(report);
    } catch (e) { dbError(res, e); }
  });

  router.get('/analytics/forecast', (req, res) => {
    try {
      const { projectId } = req.query as { projectId?: string };
      const summary = computeForecast(projectId);
      res.json(summary);
    } catch (e) { dbError(res, e); }
  });

  router.get('/analytics/proactive', (_req, res) => {
    try {
      const alerts = buildProactiveAlerts();
      res.json({ alerts: alerts.map((a) => ({ type: a.type, message: a.message, taskCount: a.tasks.length })) });
    } catch (e) { dbError(res, e); }
  });

  return router;
}
