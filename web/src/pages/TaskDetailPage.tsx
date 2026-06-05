import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchTask,
  fetchProjects,
  fetchTaskDependencies,
  updateTask,
  addTaskDependency,
  removeTaskDependency,
} from '../api.js';
import type { Task, Project, TaskStatus } from '../types.js';

const STATUS_OPTIONS: TaskStatus[] = ['todo', 'in_progress', 'blocked', 'done', 'cancelled'];

const PRIORITY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '1 — Critical' },
  { value: 2, label: '2 — High' },
  { value: 3, label: '3 — Normal' },
  { value: 4, label: '4 — Low' },
  { value: 5, label: '5 — Minimal' },
];

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<Task | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [deps, setDeps] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [priority, setPriority] = useState(3);
  const [deadline, setDeadline] = useState('');
  const [effortHours, setEffortHours] = useState('');
  const [actualHours, setActualHours] = useState('');
  const [tags, setTags] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Dependency form
  const [depInput, setDepInput] = useState('');
  const [depAdding, setDepAdding] = useState(false);
  const [depError, setDepError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;

    async function load() {
      try {
        const [t, allProjects, d] = await Promise.all([
          fetchTask(taskId!),
          fetchProjects(),
          fetchTaskDependencies(taskId!),
        ]);
        setTask(t);
        setProject(allProjects.find(p => p.id === t.project_id) ?? null);
        setDeps(d);

        setTitle(t.title);
        setDescription(t.description ?? '');
        setStatus(t.status);
        setPriority(t.priority);
        setDeadline(t.deadline?.slice(0, 10) ?? '');
        setEffortHours(t.effort_hours !== null ? String(t.effort_hours) : '');
        setActualHours(t.actual_hours !== null ? String(t.actual_hours) : '');
        setTags((t.tags ?? []).join(', '));
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [taskId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!task) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const updated = await updateTask(task.id, {
        title: title.trim(),
        description: description.trim(),
        status,
        priority,
        deadline: deadline || null,
        effort_hours: effortHours ? parseFloat(effortHours) : null,
        actual_hours: actualHours ? parseFloat(actualHours) : null,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setTask(updated);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setSaveMsg(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDep(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !depInput.trim()) return;
    setDepAdding(true);
    setDepError(null);
    try {
      await addTaskDependency(task.id, depInput.trim());
      const updated = await fetchTaskDependencies(task.id);
      setDeps(updated);
      setDepInput('');
    } catch (e: unknown) {
      setDepError((e as Error).message);
    } finally {
      setDepAdding(false);
    }
  }

  async function handleRemoveDep(depId: string) {
    if (!task) return;
    try {
      await removeTaskDependency(task.id, depId);
      setDeps(prev => prev.filter(d => d.id !== depId));
    } catch (e: unknown) {
      setDepError((e as Error).message);
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="page-error">Error: {error}</div>;
  if (!task) return <div className="page-error">Task not found</div>;

  return (
    <div className="task-detail-page">
      <header className="page-header">
        {project && (
          <Link to={`/projects/${project.id}`} className="proj-back-link">
            ← {project.name}
          </Link>
        )}
        <h1 className="page-title">Task Detail</h1>
      </header>

      <div className="task-detail-body">
        <form className="task-detail-form" onSubmit={handleSave}>
          <div className="task-field">
            <label className="task-field__label">Title</label>
            <input
              className="task-field__input"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="task-field">
            <label className="task-field__label">Description</label>
            <textarea
              className="task-field__textarea"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
            />
          </div>

          <div className="task-field-row">
            <div className="task-field">
              <label className="task-field__label">Status</label>
              <select
                className="task-field__select"
                value={status}
                onChange={e => setStatus(e.target.value as TaskStatus)}
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>

            <div className="task-field">
              <label className="task-field__label">Priority</label>
              <select
                className="task-field__select"
                value={priority}
                onChange={e => setPriority(Number(e.target.value))}
              >
                {PRIORITY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="task-field-row">
            <div className="task-field">
              <label className="task-field__label">Deadline</label>
              <input
                className="task-field__input"
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
              />
            </div>

            <div className="task-field">
              <label className="task-field__label">Effort (hours)</label>
              <input
                className="task-field__input"
                type="number"
                min="0"
                step="0.5"
                value={effortHours}
                onChange={e => setEffortHours(e.target.value)}
              />
            </div>

            <div className="task-field">
              <label className="task-field__label">Actual (hours)</label>
              <input
                className="task-field__input"
                type="number"
                min="0"
                step="0.5"
                value={actualHours}
                onChange={e => setActualHours(e.target.value)}
                placeholder="Log time spent"
              />
            </div>
          </div>

          <div className="task-field">
            <label className="task-field__label">Tags (comma-separated)</label>
            <input
              className="task-field__input"
              type="text"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="e.g. backend, urgent"
            />
          </div>

          <div className="task-field__actions">
            <button className="task-field__save-btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveMsg && <span className="task-field__save-msg">{saveMsg}</span>}
          </div>
        </form>

        <section className="task-deps">
          <h2 className="task-deps__title">Dependencies</h2>
          {deps.length === 0 ? (
            <p className="task-deps__empty">No dependencies.</p>
          ) : (
            <ul className="task-deps__list">
              {deps.map(d => (
                <li key={d.id} className="task-deps__item">
                  <Link to={`/tasks/${d.id}`} className="task-deps__link">{d.title}</Link>
                  <span className={`task-deps__status task-deps__status--${d.status}`}>
                    {d.status.replace('_', ' ')}
                  </span>
                  <button
                    className="task-deps__remove"
                    onClick={() => void handleRemoveDep(d.id)}
                    title="Remove dependency"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="task-deps__add-form" onSubmit={handleAddDep}>
            <input
              className="task-field__input"
              type="text"
              placeholder="Task ID to depend on…"
              value={depInput}
              onChange={e => setDepInput(e.target.value)}
            />
            <button className="task-field__save-btn" type="submit" disabled={depAdding || !depInput.trim()}>
              {depAdding ? '…' : 'Add'}
            </button>
          </form>
          {depError && <div className="page-error">{depError}</div>}
        </section>
      </div>
    </div>
  );
}
