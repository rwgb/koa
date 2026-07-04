import { Router } from 'express';
import { listCalendarEvents, getTask } from '../../db/index.js';
import { isCalendarConfigured } from '../../calendar/oauth.js';
import { calendarSync } from '../../calendar/sync.js';
import { getConflicts, getAvailableBlocks } from '../../calendar/conflicts.js';
import { dbError } from '../utils.js';

export function createCalendarRouter(): Router {
  const router = Router();

  router.get('/events', (req, res) => {
    if (!isCalendarConfigured()) { res.json([]); return; }
    try {
      const q = req.query as Record<string, string>;
      const start = q['start'] ?? new Date().toISOString();
      const end = q['end'] ?? new Date(Date.now() + 30 * 86_400_000).toISOString();
      res.json(listCalendarEvents(start, end));
    } catch (e) { dbError(res, e); }
  });

  router.get('/conflicts', (req, res) => {
    if (!isCalendarConfigured()) { res.json({ conflicts: [] }); return; }
    try {
      const q = req.query as Record<string, string>;
      if (!q['taskId']) { res.status(400).json({ error: 'taskId required' }); return; }
      const task = getTask(q['taskId']);
      if (!task) { res.status(404).json({ error: 'task not found' }); return; }
      res.json(getConflicts(task));
    } catch (e) { dbError(res, e); }
  });

  router.get('/availability', (req, res) => {
    if (!isCalendarConfigured()) { res.json([]); return; }
    try {
      const q = req.query as Record<string, string>;
      const start = q['start'] ?? new Date().toISOString();
      const end = q['end'] ?? new Date(Date.now() + 7 * 86_400_000).toISOString();
      res.json(getAvailableBlocks(start, end));
    } catch (e) { dbError(res, e); }
  });

  router.post('/sync', (_req, res) => {
    if (!isCalendarConfigured()) {
      res.status(400).json({ error: 'Google Calendar not configured' }); return;
    }
    calendarSync.syncNow()
      .then(() => res.json({ ok: true }))
      .catch(e => { console.error('[koa/calendar] sync error:', e); res.status(500).json({ error: 'Calendar sync failed' }); });
  });

  return router;
}
