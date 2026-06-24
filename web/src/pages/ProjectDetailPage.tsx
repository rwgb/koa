import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchProjects, fetchTasks, fetchNextTasks, createTask } from '../api.js';
import type { Project, Task, TaskStatus } from '../types.js';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo',        label: 'Todo' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'done',        label: 'Done' },
  { status: 'cancelled',   label: 'Cancelled' },
];

const PRIORITY_LABELS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Critical', cls: 'priority--critical' },
  2: { label: 'High',     cls: 'priority--high' },
  3: { label: 'Normal',   cls: 'priority--normal' },
  4: { label: 'Low',      cls: 'priority--low' },
  5: { label: 'Minimal',  cls: 'priority--minimal' },
};

function PriorityBadge({ priority }: { priority: number }) {
  const info = PRIORITY_LABELS[priority] ?? { label: String(priority), cls: 'priority--normal' };
  return <span className={`task-priority ${info.cls}`}>{info.label}</span>;
}

function TaskCard({ task }: { task: Task }) {
  const navigate = useNavigate();
  return (
    <div className="kanban-task" onClick={() => navigate(`/tasks/${task.id}`)}>
      <span className="kanban-task__title">{task.title}</span>
      <div className="kanban-task__meta">
        <PriorityBadge priority={task.priority} />
        {task.deadline && (
          <span className="kanban-task__deadline">{task.deadline.slice(0, 10)}</span>
        )}
      </div>
      {task.tags.length > 0 && (
        <div className="kanban-task__tags">
          {task.tags.map(t => <span key={t} className="kanban-task__tag">{t}</span>)}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({
  status,
  label,
  tasks,
  projectId,
  onTaskCreated,
}: {
  status: TaskStatus;
  label: string;
  tasks: Task[];
  projectId: string;
  onTaskCreated: (task: Task) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setAdding(true);
    setAddError(null);
    try {
      const task = await createTask(projectId, title.trim());
      onTaskCreated(task);
      setTitle('');
      setShowAdd(false);
    } catch (err) {
      // Retain the title so the user doesn't lose their input on failure.
      setAddError(err instanceof Error ? err.message : 'Failed to create task. Please try again.');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="kanban-col">
      <div className="kanban-col__header">
        <span className="kanban-col__label">{label}</span>
        <span className="kanban-col__count">{tasks.length}</span>
      </div>
      <div className="kanban-col__tasks">
        {tasks.map(t => <TaskCard key={t.id} task={t} />)}
      </div>
      {status === 'todo' && (
        showAdd ? (
          <form className="kanban-add-form" onSubmit={handleAdd}>
            <input
              className="kanban-add-form__input"
              type="text"
              placeholder="Task title…"
              value={title}
              onChange={e => { setTitle(e.target.value); setAddError(null); }}
              autoFocus
            />
            <div className="kanban-add-form__actions">
              <button className="kanban-add-form__btn" type="submit" disabled={adding || !title.trim()}>
                {adding ? '…' : 'Add'}
              </button>
              <button className="kanban-add-form__btn kanban-add-form__btn--cancel" type="button" onClick={() => { setShowAdd(false); setAddError(null); }}>
                Cancel
              </button>
            </div>
            {addError && (
              <div className="kanban-add-form__error">
                <span>{addError}</span>
                <button
                  className="kanban-add-form__error-dismiss"
                  type="button"
                  aria-label="Dismiss error"
                  onClick={() => setAddError(null)}
                >
                  &times;
                </button>
              </div>
            )}
          </form>
        ) : (
          <button className="kanban-col__add-btn" onClick={() => setShowAdd(true)}>
            + Add Task
          </button>
        )
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nextTasks, setNextTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!projectId) return;

    async function load() {
      try {
        const [allProjects, allTasks, next] = await Promise.all([
          fetchProjects(),
          fetchTasks({ projectId }),
          fetchNextTasks(projectId, 5),
        ]);
        const found = allProjects.find(p => p.id === projectId || p.slug === projectId);
        if (!found) { setError('Project not found'); return; }
        setProject(found);
        setTasks(allTasks);
        setNextTasks(next);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [projectId]);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="page-error">Error: {error}</div>;
  if (!project) return <div className="page-error">Project not found</div>;

  function handleTaskCreated(task: Task) {
    setTasks(prev => [task, ...prev]);
  }

  const tasksByStatus = (status: TaskStatus) => tasks.filter(t => t.status === status);

  return (
    <div className="project-detail-page">
      <header className="page-header">
        <Link to="/projects" className="proj-back-link">← Projects</Link>
        <div className="page-header__row">
          <div>
            <h1 className="page-title">{project.name}</h1>
            {project.description && <p className="page-subtitle">{project.description}</p>}
          </div>
          <span className={`proj-status proj-status--${project.status}`}>
            {project.status}
          </span>
        </div>
      </header>

      {nextTasks.length > 0 && (
        <section className="next-tasks-section">
          <h2 className="next-tasks-section__title">Next Up</h2>
          <div className="next-tasks-list">
            {nextTasks.map(t => (
              <div key={t.id} className="next-task-card" onClick={() => navigate(`/tasks/${t.id}`)}>
                <span className="next-task-card__title">{t.title}</span>
                <PriorityBadge priority={t.priority} />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="kanban-board">
        {COLUMNS.map(col => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={tasksByStatus(col.status)}
            projectId={project.id}
            onTaskCreated={handleTaskCreated}
          />
        ))}
      </div>
    </div>
  );
}
