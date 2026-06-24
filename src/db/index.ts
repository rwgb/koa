import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { runMigrations } from './migrations.js';
import type { Project, Task, TaskDependency, Decision, Checkpoint, AuditLog, ProjectStatus, TaskStatus, CalendarEvent, NotificationLog, EscalationLevel, Conversation, ConversationTurn } from './schema.js';
export type { Project, Task, TaskDependency, Decision, Checkpoint, AuditLog, ProjectStatus, TaskStatus, CalendarEvent, NotificationLog, EscalationLevel, Conversation, ConversationTurn };

// ── Singleton ──────────────────────────────────────────────────────────────

function dbPath(): string {
  const home = process.env['KOA_HOME'] ?? os.homedir();
  return path.join(home, '.koa', 'koa.db');
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const p = dbPath();
    fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
    _db = new Database(p);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    runMigrations(_db);
  }
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

// Monotonic counter prevents task ID collisions when multiple tasks are created
// within the same millisecond (common in tests and batch imports).
let _taskSeq = 0;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as string[];
  } catch {
    // fall through
  }
  return [];
}

interface RawTask {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  deadline: string | null;
  effort_hours: number | null;
  actual_hours: number | null;
  tags: string;
  created_at: string;
  updated_at: string;
}

function hydrateTask(row: RawTask): Task {
  return {
    ...row,
    status: row.status as TaskStatus,
    actual_hours: row.actual_hours ?? null,
    tags: parseTags(row.tags),
  };
}

interface RawProject {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  budget_usd: number | null;
  created_at: string;
  updated_at: string;
}

function hydrateProject(row: RawProject): Project {
  return {
    ...row,
    status: row.status as ProjectStatus,
    budget_usd: row.budget_usd ?? null,
  };
}

interface RawDecision {
  id: string;
  project_id: string;
  title: string;
  context: string;
  options: string;
  chosen: string;
  rationale: string;
  created_at: string;
}

function hydrateDecision(row: RawDecision): Decision {
  return {
    ...row,
    options: parseTags(row.options),
  };
}

// ── Audit ──────────────────────────────────────────────────────────────────

export function audit(
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown> = {},
): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO audit_log (entity_type, entity_id, action, payload, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(entityType, entityId, action, JSON.stringify(payload), now());
  } catch (err) {
    process.stderr.write(`[koa/db] audit error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

// ── Projects ───────────────────────────────────────────────────────────────

export function createProject(
  name: string,
  description = '',
  slug?: string,
): Project {
  const db = getDb();
  const resolvedSlug = slug ?? slugify(name);
  const existing = db.prepare('SELECT id FROM projects WHERE slug = ?').get(resolvedSlug);
  if (existing) throw new Error(`Project slug already exists: "${resolvedSlug}"`);

  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    'INSERT INTO projects (id, slug, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, resolvedSlug, name, description, 'active', ts, ts);

  audit('project', id, 'create', { name, slug: resolvedSlug });
  return getProject(id) as Project;
}

export function getProject(id: string): Project | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as RawProject | undefined;
  return row ? hydrateProject(row) : null;
}

export function getProjectBySlug(slug: string): Project | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug) as RawProject | undefined;
  return row ? hydrateProject(row) : null;
}

export function listProjects(status?: ProjectStatus): Project[] {
  const db = getDb();
  const rows = status
    ? (db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC LIMIT 500').all(status) as RawProject[])
    : (db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 500').all() as RawProject[]);
  return rows.map(hydrateProject);
}

export function updateProject(
  id: string,
  updates: Partial<Pick<Project, 'name' | 'description' | 'status' | 'budget_usd'>>,
): Project {
  const db = getDb();
  const project = getProject(id);
  if (!project) throw new Error(`Project not found: ${id}`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if ('budget_usd' in updates) { fields.push('budget_usd = ?'); values.push(updates.budget_usd ?? null); }

  if (fields.length === 0) return project;

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  audit('project', id, 'update', updates as Record<string, unknown>);
  return getProject(id) as Project;
}

export function deleteProject(id: string): void {
  // Soft delete — archive only
  updateProject(id, { status: 'archived' });
  audit('project', id, 'archive');
}

export function getProjectBudget(projectId: string): number | null {
  const db = getDb();
  const row = db.prepare('SELECT budget_usd FROM projects WHERE id = ?').get(projectId);
  return (row as { budget_usd: number | null } | undefined)?.budget_usd ?? null;
}

/** Sum of recorded turn costs across all conversations linked to the project. */
export function getProjectCumulativeCost(projectId: string): number {
  const db = getDb();
  const row = db.prepare(
    `SELECT COALESCE(SUM(t.cost_usd), 0) AS total
       FROM conversation_turns t
       JOIN conversations c ON c.id = t.conversation_id
      WHERE c.project_id = ?`,
  ).get(projectId);
  return (row as { total: number } | undefined)?.total ?? 0;
}

// ── Tasks ──────────────────────────────────────────────────────────────────

export function createTask(
  projectId: string,
  title: string,
  opts: {
    description?: string;
    priority?: number;
    deadline?: string | null;
    effortHours?: number | null;
    tags?: string[];
  } = {},
): Task {
  const db = getDb();
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const id = `${project.slug}-task-${Date.now()}-${++_taskSeq}`;
  const ts = now();
  const description = opts.description ?? '';
  const priority = opts.priority ?? 3;
  const deadline = opts.deadline ?? null;
  const effortHours = opts.effortHours ?? null;
  const tags = JSON.stringify(opts.tags ?? []);

  db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, deadline, effort_hours, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, title, description, 'todo', priority, deadline, effortHours, tags, ts, ts);

  // Sync standalone FTS index
  db.prepare(
    `INSERT INTO tasks_fts(task_id, title, description, tags) VALUES (?, ?, ?, ?)`,
  ).run(id, title, description, tags);

  audit('task', id, 'create', { projectId, title, priority });
  return getTask(id) as Task;
}

export function getTask(id: string): Task | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as RawTask | undefined;
  return row ? hydrateTask(row) : null;
}

export function listTasks(filter?: { projectId?: string; status?: TaskStatus; priority?: number }): Task[] {
  const db = getDb();
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (filter?.projectId) { conditions.push('project_id = ?'); values.push(filter.projectId); }
  if (filter?.status) { conditions.push('status = ?'); values.push(filter.status); }
  if (filter?.priority !== undefined) { conditions.push('priority = ?'); values.push(filter.priority); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY priority ASC, deadline ASC NULLS LAST LIMIT 500`)
    .all(...values) as RawTask[];

  return rows.map(hydrateTask);
}

export function updateTask(
  id: string,
  updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'deadline' | 'effort_hours' | 'actual_hours' | 'tags'>>,
): Task {
  const db = getDb();
  const task = getTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);

  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if ('deadline' in updates) { fields.push('deadline = ?'); values.push(updates.deadline ?? null); }
  if ('effort_hours' in updates) { fields.push('effort_hours = ?'); values.push(updates.effort_hours ?? null); }
  if ('actual_hours' in updates) { fields.push('actual_hours = ?'); values.push(updates.actual_hours ?? null); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }

  if (fields.length === 0) return task;

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

  // Sync standalone FTS: remove old entry then insert updated values
  db.prepare(`DELETE FROM tasks_fts WHERE task_id = ?`).run(id);
  const updated = getTask(id) as Task;
  db.prepare(`INSERT INTO tasks_fts(task_id, title, description, tags) VALUES (?, ?, ?, ?)`)
    .run(id, updated.title, updated.description, JSON.stringify(updated.tags));

  audit('task', id, 'update', updates as Record<string, unknown>);
  return updated;
}

export function deleteTask(id: string): void {
  const db = getDb();
  const task = getTask(id);
  if (!task) throw new Error(`Task not found: ${id}`);

  db.prepare(`DELETE FROM tasks_fts WHERE task_id = ?`).run(id);
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ? OR depends_on_id = ?').run(id, id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  audit('task', id, 'delete', { title: task.title });
}

/**
 * Returns tasks with no unresolved blockers (all depends_on tasks are 'done'),
 * sorted by priority ASC then deadline ASC nulls last.
 */
export function getNextTasks(projectId?: string, limit = 10): Task[] {
  const db = getDb();
  const safeLimit = Math.min(isNaN(limit) ? 10 : Math.max(1, limit), 100);
  const projectFilter = projectId ? 'AND t.project_id = ?' : '';
  const values: unknown[] = [];
  if (projectId) values.push(projectId);

  // A task is unblocked if it has zero dependencies, or all its dependencies are done
  const sql = `
    SELECT t.*
    FROM tasks t
    WHERE t.status NOT IN ('done', 'cancelled')
      ${projectFilter}
      AND NOT EXISTS (
        SELECT 1
        FROM task_dependencies td
        JOIN tasks dep ON dep.id = td.depends_on_id
        WHERE td.task_id = t.id
          AND dep.status != 'done'
      )
    ORDER BY t.priority ASC, t.deadline ASC NULLS LAST
    LIMIT ?
  `;
  values.push(safeLimit);

  const rows = db.prepare(sql).all(...values) as RawTask[];
  return rows.map(hydrateTask);
}

// ── Dependencies ───────────────────────────────────────────────────────────

export function addDependency(taskId: string, dependsOnId: string): void {
  const db = getDb();

  if (!getTask(taskId)) throw new Error(`Task not found: ${taskId}`);
  if (!getTask(dependsOnId)) throw new Error(`Task not found: ${dependsOnId}`);

  // Recursive cycle check: taskId must not be reachable from dependsOnId through existing deps
  const cycleExists = db
    .prepare(
      `WITH RECURSIVE reachable(id) AS (
         SELECT depends_on_id FROM task_dependencies WHERE task_id = ?
         UNION ALL
         SELECT td.depends_on_id FROM task_dependencies td JOIN reachable r ON r.id = td.task_id
       )
       SELECT 1 FROM reachable WHERE id = ?`,
    )
    .get(dependsOnId, taskId);
  if (cycleExists) {
    throw new Error(`Adding dependency would create a cycle: ${dependsOnId} already transitively depends on ${taskId}`);
  }

  db.prepare(
    'INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)',
  ).run(taskId, dependsOnId);

  audit('task_dependency', taskId, 'add_dependency', { dependsOnId });
}

export function removeDependency(taskId: string, dependsOnId: string): void {
  const db = getDb();
  db.prepare(
    'DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?',
  ).run(taskId, dependsOnId);
  audit('task_dependency', taskId, 'remove_dependency', { dependsOnId });
}

export function getTaskDependencies(taskId: string): Task[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT t.* FROM tasks t
     JOIN task_dependencies td ON td.depends_on_id = t.id
     WHERE td.task_id = ?
     ORDER BY t.priority ASC`,
  ).all(taskId) as RawTask[];
  return rows.map(hydrateTask);
}

// ── Decisions ──────────────────────────────────────────────────────────────

export function createDecision(
  projectId: string,
  title: string,
  opts: {
    context?: string;
    options?: string[];
    chosen?: string;
    rationale?: string;
  } = {},
): Decision {
  const db = getDb();
  if (!getProject(projectId)) throw new Error(`Project not found: ${projectId}`);

  const id = crypto.randomUUID();
  const ts = now();
  const context = opts.context ?? '';
  const options = JSON.stringify(opts.options ?? []);
  const chosen = opts.chosen ?? '';
  const rationale = opts.rationale ?? '';

  db.prepare(
    `INSERT INTO decisions (id, project_id, title, context, options, chosen, rationale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, title, context, options, chosen, rationale, ts);

  audit('decision', id, 'create', { projectId, title });

  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as RawDecision;
  return hydrateDecision(row);
}

export function listDecisions(projectId?: string): Decision[] {
  const db = getDb();
  const rows = projectId
    ? (db.prepare('SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 500').all(projectId) as RawDecision[])
    : (db.prepare('SELECT * FROM decisions ORDER BY created_at DESC LIMIT 500').all() as RawDecision[]);
  return rows.map(hydrateDecision);
}

// ── Checkpoints ────────────────────────────────────────────────────────────

export function recordCheckpoint(projectId: string, label: string, notes = ''): Checkpoint {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();

  db.prepare(
    'INSERT INTO checkpoints (id, project_id, label, notes, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, projectId, label, notes, ts);

  audit('checkpoint', id, 'create', { projectId, label });

  return db.prepare('SELECT * FROM checkpoints WHERE id = ?').get(id) as Checkpoint;
}

export function listCheckpoints(projectId?: string): Checkpoint[] {
  const db = getDb();
  return projectId
    ? (db.prepare('SELECT * FROM checkpoints WHERE project_id = ? ORDER BY created_at DESC LIMIT 500').all(projectId) as Checkpoint[])
    : (db.prepare('SELECT * FROM checkpoints ORDER BY created_at DESC LIMIT 500').all() as Checkpoint[]);
}

// ── Search ─────────────────────────────────────────────────────────────────

/**
 * Escapes a raw user string into a safe FTS5 literal.
 * Double-quotes inside the value are doubled (""), then the whole string is
 * wrapped in double-quotes so FTS5 treats it as a phrase rather than parsing
 * any embedded operators (AND/OR/NOT/NEAR/column filters).
 */
function escapeFts(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export function searchTasks(query: string, projectId?: string): Task[] {
  const db = getDb();

  const trimmed = query.slice(0, 200);
  const ftsQuery = escapeFts(trimmed);

  try {
    // FTS5 search via standalone tasks_fts table
    const projectFilter = projectId ? 'AND t.project_id = ?' : '';
    const ftsValues: unknown[] = [ftsQuery];
    if (projectId) ftsValues.push(projectId);

    const rows = db.prepare(
      `SELECT t.* FROM tasks t
       JOIN tasks_fts ON tasks_fts.task_id = t.id
       WHERE tasks_fts MATCH ?
         ${projectFilter}
       ORDER BY rank, t.priority ASC
       LIMIT 50`,
    ).all(...ftsValues) as RawTask[];

    if (rows.length > 0) return rows.map(hydrateTask);
  } catch {
    // FTS query may be invalid; fall through to LIKE
  }

  // Fallback: LIKE search on title and description (uses already-trimmed input)
  const likeQuery = `%${trimmed}%`;
  const conditions = ['(t.title LIKE ? OR t.description LIKE ?)'];
  const likeValues: unknown[] = [likeQuery, likeQuery];
  if (projectId) { conditions.push('t.project_id = ?'); likeValues.push(projectId); }

  const rows = db.prepare(
    `SELECT t.* FROM tasks t WHERE ${conditions.join(' AND ')} ORDER BY t.priority ASC LIMIT 50`,
  ).all(...likeValues) as RawTask[];

  return rows.map(hydrateTask);
}

// ── STATE.md generation ────────────────────────────────────────────────────

export function generateStateFromDb(projectId?: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const lines: string[] = [`# STATE.md — generated ${ts} UTC\n`];

  // Project(s) info
  if (projectId) {
    const project = getProject(projectId);
    if (project) {
      lines.push(`## Projects`);
      lines.push(`- **${project.name}** (\`${project.slug}\`) — ${project.status}`);
      if (project.description) lines.push(`  ${project.description}`);
      lines.push('');
    }
  } else {
    const allProjects = listProjects();
    if (allProjects.length > 0) {
      lines.push('## Projects');
      for (const p of allProjects) {
        lines.push(`- **${p.name}** (\`${p.slug}\`) — ${p.status}`);
      }
      lines.push('');
    }
  }

  // Tasks by status
  const statusOrder: TaskStatus[] = ['in_progress', 'blocked', 'todo', 'done', 'cancelled'];
  const statusLabels: Record<TaskStatus, string> = {
    in_progress: 'In Progress',
    blocked: 'Blocked',
    todo: 'To Do',
    done: 'Done',
    cancelled: 'Cancelled',
  };

  const allTasks = listTasks(projectId ? { projectId } : undefined);

  for (const status of statusOrder) {
    const group = allTasks.filter((t) => t.status === status);
    if (group.length === 0) continue;
    lines.push(`## ${statusLabels[status]}`);
    for (const t of group) {
      const tags = t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : '';
      const deadline = t.deadline ? ` · due ${t.deadline}` : '';
      const marker = status === 'done' ? '[x]' : status === 'cancelled' ? '[-]' : '[ ]';
      lines.push(`- ${marker} **${t.title}**${tags}${deadline} (priority ${t.priority})`);
    }
    lines.push('');
  }

  // Next unblocked tasks
  const nextTasks = getNextTasks(projectId, 5);
  if (nextTasks.length > 0) {
    lines.push('## Next Up (Unblocked)');
    for (const t of nextTasks) {
      lines.push(`- [ ] ${t.title} (priority ${t.priority})`);
    }
    lines.push('');
  }

  // Recent decisions
  const decisions = listDecisions(projectId).slice(0, 5);
  if (decisions.length > 0) {
    lines.push('## Recent Decisions');
    for (const d of decisions) {
      lines.push(`- **${d.title}**: chose _${d.chosen}_ — ${d.rationale}`);
    }
    lines.push('');
  }

  // Last checkpoint
  const [lastCp] = listCheckpoints(projectId);
  if (lastCp) {
    lines.push('## Last Checkpoint');
    lines.push(`**${lastCp.label}** — ${lastCp.created_at.slice(0, 10)}`);
    if (lastCp.notes) lines.push(lastCp.notes);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Calendar events ────────────────────────────────────────────────────────

interface CalendarEventRow {
  id: string;
  google_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  location: string | null;
  description: string | null;
  attendees: string;
  recurrence: string | null;
  synced_at: string;
}

function rowToCalendarEvent(row: CalendarEventRow): CalendarEvent {
  const base: CalendarEvent = {
    id: row.id,
    google_id: row.google_id,
    title: row.title,
    start_at: row.start_at,
    end_at: row.end_at,
    all_day: row.all_day === 1,
    attendees: JSON.parse(row.attendees) as string[],
    synced_at: row.synced_at,
  };
  if (row.location != null) base.location = row.location;
  if (row.description != null) base.description = row.description;
  if (row.recurrence != null) base.recurrence = row.recurrence;
  return base;
}

export function upsertCalendarEvent(event: Omit<CalendarEvent, 'id' | 'synced_at'> & { source_integration_id?: string }): CalendarEvent {
  const db = getDb();
  const id = `cal-${event.google_id}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO calendar_events (id, google_id, title, start_at, end_at, all_day, location, description, attendees, recurrence, synced_at, source_integration_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_id) DO UPDATE SET
      title = excluded.title,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      all_day = excluded.all_day,
      location = excluded.location,
      description = excluded.description,
      attendees = excluded.attendees,
      recurrence = excluded.recurrence,
      synced_at = excluded.synced_at,
      source_integration_id = excluded.source_integration_id
  `).run(
    id, event.google_id, event.title, event.start_at, event.end_at,
    event.all_day ? 1 : 0,
    event.location ?? null, event.description ?? null,
    JSON.stringify(event.attendees),
    event.recurrence ?? null, now,
    event.source_integration_id ?? 'google-calendar',
  );
  const result: CalendarEvent = {
    id,
    google_id: event.google_id,
    title: event.title,
    start_at: event.start_at,
    end_at: event.end_at,
    all_day: event.all_day,
    attendees: event.attendees,
    synced_at: now,
  };
  if (event.location != null) result.location = event.location;
  if (event.description != null) result.description = event.description;
  if (event.recurrence != null) result.recurrence = event.recurrence;
  return result;
}

export function listCalendarEvents(startIso: string, endIso: string): CalendarEvent[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM calendar_events
    WHERE start_at < ? AND end_at > ?
    ORDER BY start_at ASC
    LIMIT 500
  `).all(endIso, startIso) as CalendarEventRow[];
  return rows.map(rowToCalendarEvent);
}

export function deleteCalendarEventsNotIn(googleIds: string[], integrationId: string): void {
  const db = getDb();
  if (googleIds.length === 0) {
    db.prepare('DELETE FROM calendar_events WHERE source_integration_id = ?').run(integrationId);
    return;
  }
  const placeholders = googleIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM calendar_events WHERE source_integration_id = ? AND google_id NOT IN (${placeholders})`).run(integrationId, ...googleIds);
}

export function deleteCalendarEventsBySourceId(integrationId: string): void {
  getDb().prepare('DELETE FROM calendar_events WHERE source_integration_id = ?').run(integrationId);
}

// ── Notification log ────────────────────────────────────────────────────────

const VALID_ESCALATION_LEVELS: readonly EscalationLevel[] = ['due-tomorrow', '24h', '8h', 'overdue'];

export function logNotification(taskId: string, level: EscalationLevel, channel: string): void {
  if (!(VALID_ESCALATION_LEVELS as string[]).includes(level)) {
    throw new Error(`Invalid escalation level: ${level}`);
  }
  getDb()
    .prepare(`INSERT INTO notification_log (task_id, escalation_level, channel, sent_at) VALUES (?, ?, ?, ?)`)
    .run(taskId, level, channel, now());
}

export function getLastNotificationFor(taskId: string, level: EscalationLevel): NotificationLog | null {
  const row = getDb()
    .prepare(`SELECT * FROM notification_log WHERE task_id = ? AND escalation_level = ? ORDER BY sent_at DESC LIMIT 1`)
    .get(taskId, level) as NotificationLog | undefined;
  return row ?? null;
}

// ── Analytics ──────────────────────────────────────────────────────────────

/** Returns distinct YYYY-MM-DD strings (UTC) on which at least one task was marked done. */
export function getCompletionDates(): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT date(created_at) AS d
       FROM audit_log
       WHERE entity_type = 'task'
         AND action = 'update'
         AND json_extract(payload, '$.status') = 'done'
       ORDER BY d DESC
       LIMIT 365`,
    )
    .all() as { d: string }[];
  return rows.map((r) => r.d);
}

/** Returns tasks whose status is 'blocked' and has been blocked for at least `minDays` days. */
export function getBlockedTasksSince(minDays: number): Task[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE status = 'blocked'
         AND datetime(updated_at) <= datetime('now', ? || ' days')
       ORDER BY priority ASC, updated_at ASC
       LIMIT 50`,
    )
    .all(`-${minDays}`) as RawTask[];
  return rows.map(hydrateTask);
}

export interface ForecastRow {
  id: string;
  title: string;
  project_id: string;
  effort_hours: number;
  actual_hours: number;
}

/** Returns done tasks that have both effort_hours and actual_hours set, for ratio computation. */
export function getForecastData(projectId?: string): ForecastRow[] {
  const projectFilter = projectId ? 'AND project_id = ?' : '';
  const values: unknown[] = projectId ? [projectId] : [];
  const rows = getDb()
    .prepare(
      `SELECT id, title, project_id, effort_hours, actual_hours
       FROM tasks
       WHERE status = 'done'
         AND effort_hours IS NOT NULL
         AND actual_hours IS NOT NULL
         ${projectFilter}
       ORDER BY updated_at DESC
       LIMIT 200`,
    )
    .all(...values) as ForecastRow[];
  return rows;
}

/** Returns tasks not yet done, due within `days` days, ordered by priority. */
export function getUpcomingTasks(days: number, projectId?: string): Task[] {
  const projectFilter = projectId ? 'AND project_id = ?' : '';
  const values: unknown[] = [`+${days} days`];
  if (projectId) values.push(projectId);
  const rows = getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE status NOT IN ('done', 'cancelled')
         AND deadline IS NOT NULL
         AND deadline <= date('now', ?)
         ${projectFilter}
       ORDER BY priority ASC, deadline ASC
       LIMIT 50`,
    )
    .all(...values) as RawTask[];
  return rows.map(hydrateTask);
}

// ── Delegations ────────────────────────────────────────────────────────────────

export interface Delegation {
  id: string;
  pattern: string;
  action: string;
  schedule: string;
  last_run: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function createDelegation(data: { pattern: string; action: string; schedule: string }): Delegation {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  db.prepare(`
    INSERT INTO delegations (id, pattern, action, schedule, last_run, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, 1, ?, ?)
  `).run(id, data.pattern, data.action, data.schedule, ts, ts);
  return getDelegation(id)!;
}

export function listDelegations(): Delegation[] {
  return getDb()
    .prepare('SELECT * FROM delegations ORDER BY created_at DESC')
    .all() as Delegation[];
}

export function getDelegation(id: string): Delegation | null {
  return (getDb().prepare('SELECT * FROM delegations WHERE id = ?').get(id) as Delegation) ?? null;
}

const DELEGATION_ALLOWED_KEYS = new Set(['pattern', 'action', 'schedule', 'enabled', 'last_run']);

export function updateDelegation(
  id: string,
  updates: Partial<Pick<Delegation, 'pattern' | 'action' | 'schedule' | 'enabled' | 'last_run'>>,
): Delegation | null {
  const keys = Object.keys(updates);
  for (const k of keys) {
    if (!DELEGATION_ALLOWED_KEYS.has(k)) throw new Error(`updateDelegation: disallowed key "${k}"`);
  }
  const db = getDb();
  const ts = new Date().toISOString();
  const fields = keys.map(k => `${k} = ?`).join(', ');
  if (!fields) return getDelegation(id);
  db.prepare(`UPDATE delegations SET ${fields}, updated_at = ? WHERE id = ?`).run(...Object.values(updates), ts, id);
  return getDelegation(id);
}

export function deleteDelegation(id: string): void {
  getDb().prepare('DELETE FROM delegations WHERE id = ?').run(id);
}

// ── Conversations ──────────────────────────────────────────────────────────

export function createConversation(projectId?: string): Conversation {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    'INSERT INTO conversations (id, started_at, turn_count, project_id) VALUES (?, ?, 0, ?)',
  ).run(id, ts, projectId ?? null);
  return getConversation(id) as Conversation;
}

export function closeConversation(id: string, turnCount: number): void {
  getDb().prepare(
    'UPDATE conversations SET ended_at = ?, turn_count = ? WHERE id = ?',
  ).run(now(), turnCount, id);
}

export function updateConversationTitle(id: string, title: string): void {
  getDb().prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
}

export function addConversationTurn(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
  opts: { agentName?: string; model?: string; costUsd?: number; toolUses?: unknown[] } = {},
): ConversationTurn {
  const db = getDb();
  const id = crypto.randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO conversation_turns
       (id, conversation_id, role, content, tool_uses, agent_name, model, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, conversationId, role, content,
    JSON.stringify(opts.toolUses ?? []),
    opts.agentName ?? null,
    opts.model ?? null,
    opts.costUsd ?? null,
    ts,
  );
  if (content) {
    db.prepare(
      'INSERT INTO conversation_turns_fts(turn_id, content, conversation_id) VALUES (?, ?, ?)',
    ).run(id, content, conversationId);
  }
  return db.prepare('SELECT * FROM conversation_turns WHERE id = ?').get(id) as ConversationTurn;
}

export function listConversations(limit = 50): Conversation[] {
  return getDb()
    .prepare('SELECT * FROM conversations ORDER BY started_at DESC LIMIT ?')
    .all(limit) as Conversation[];
}

export function getConversation(id: string): Conversation | null {
  return (getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined) ?? null;
}

export function getConversationTurns(conversationId: string): ConversationTurn[] {
  return getDb()
    .prepare('SELECT * FROM conversation_turns WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as ConversationTurn[];
}

export function deleteConversationsBefore(date: string): number {
  const result = getDb()
    .prepare('DELETE FROM conversations WHERE started_at < ?')
    .run(date);
  return result.changes;
}

export function searchConversations(
  query: string,
): Array<{ conversationId: string; turnId: string; excerpt: string }> {
  if (!query.trim()) return [];
  const trimmed = query.slice(0, 200);
  const ftsQuery = escapeFts(trimmed);
  const db = getDb();
  try {
    return db.prepare(
      `SELECT ct.conversation_id AS conversationId, ct.id AS turnId,
              substr(ct.content, 1, 300) AS excerpt
       FROM conversation_turns ct
       JOIN conversation_turns_fts ON conversation_turns_fts.turn_id = ct.id
       WHERE conversation_turns_fts MATCH ?
       ORDER BY rank
       LIMIT 30`,
    ).all(ftsQuery) as Array<{ conversationId: string; turnId: string; excerpt: string }>;
  } catch {
    const like = `%${trimmed}%`;
    return db.prepare(
      `SELECT conversation_id AS conversationId, id AS turnId,
              substr(content, 1, 300) AS excerpt
       FROM conversation_turns
       WHERE content LIKE ?
       LIMIT 30`,
    ).all(like) as Array<{ conversationId: string; turnId: string; excerpt: string }>;
  }
}
