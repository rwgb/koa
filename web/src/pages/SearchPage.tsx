import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchItems, fetchProjects } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Task, Project } from '../types.js';

const PRIORITY_LABELS: Record<number, { label: string; cls: string }> = {
  1: { label: 'Critical', cls: 'priority--critical' },
  2: { label: 'High',     cls: 'priority--high'     },
  3: { label: 'Normal',   cls: 'priority--normal'   },
  4: { label: 'Low',      cls: 'priority--low'      },
  5: { label: 'Minimal',  cls: 'priority--minimal'  },
};

function SearchTaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const info = PRIORITY_LABELS[task.priority] ?? { label: String(task.priority), cls: 'priority--normal' };
  return (
    <div className="kanban-task search-result-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <span className="kanban-task__title">{task.title}</span>
      <div className="kanban-task__meta">
        <span className={`task-priority ${info.cls}`}>{info.label}</span>
        <span className="kanban-task__status">{task.status.replace('_', ' ')}</span>
        {task.deadline && <span className="kanban-task__deadline">{task.deadline.slice(0, 10)}</span>}
      </div>
      {task.tags.length > 0 && (
        <div className="kanban-task__tags">
          {task.tags.map(t => <span key={t} className="kanban-task__tag">{t}</span>)}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery]         = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects]   = useState<Project[]>([]);
  const [results, setResults]     = useState<Task[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched]   = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const navigate  = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    fetchProjects()
      .then(setProjects)
      .catch(() => { /* non-critical */ });
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setError(null);
      searchItems(query.trim(), projectId || undefined)
        .then(r => { setResults(r); setSearched(true); })
        .catch((e: unknown) => setError((e as Error).message))
        .finally(() => setSearching(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, projectId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <h1 className="page-title">Search</h1>
        <p className="page-subtitle">Find tasks across your projects.</p>
      </div>

      <div className="page-body">
        {/* Search bar row */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <label className="form-label" htmlFor="search-query">Query</label>
            <input
              ref={inputRef}
              id="search-query"
              className="form-input"
              type="text"
              placeholder="Search tasks…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div style={{ minWidth: '180px' }}>
            <label className="form-label" htmlFor="search-project">Project</label>
            <select
              id="search-project"
              className="form-select"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {error && <div className="page-error">{error}</div>}

        {!query.trim() && (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">Type to search</p>
            <p className="empty-state__body">Search across task titles, descriptions, and tags.</p>
          </div>
        )}

        {searching && <div className="page-loading">Searching…</div>}

        {!searching && searched && results.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">No results</p>
            <p className="empty-state__body">No tasks found for "{query}".</p>
          </div>
        )}

        {!searching && results.length > 0 && (
          <div className="search-results">
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              {results.length} result{results.length !== 1 ? 's' : ''}
            </div>
            <div className="search-results__list">
              {results.map(t => (
                <SearchTaskCard
                  key={t.id}
                  task={t}
                  onClick={() => navigate(`/tasks/${t.id}`)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
