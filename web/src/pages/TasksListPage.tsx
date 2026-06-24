import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTasks } from '../api.js';
import type { Task } from '../types.js';

export default function TasksListPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchTasks();
        setTasks(data);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="tasks-list-page">
      <header className="page-header">
        <h1 className="page-title">Tasks</h1>
      </header>

      {tasks.length === 0 ? (
        <p className="tasks-list-page__empty">No tasks found.</p>
      ) : (
        <ul className="tasks-list-page__list">
          {tasks.map(task => (
            <li key={task.id} className="tasks-list-page__item">
              <Link to={`/tasks/${task.id}`} className="tasks-list-page__link">
                {task.title}
              </Link>
              <span className={`tasks-list-page__status tasks-list-page__status--${task.status}`}>
                {task.status.replace('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
