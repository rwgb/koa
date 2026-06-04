import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { searchItems, fetchProjects, searchConversations } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Task, Project, ConversationSearchResult } from '../types.js';

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

function ConversationResultCard({ result, onClick }: { result: ConversationSearchResult; onClick: () => void }) {
  const title = result.title ?? 'Untitled session';
  const date = result.started_at ? result.started_at.slice(0, 10) : '';
  const excerpt = result.excerpt.length > 150 ? `${result.excerpt.slice(0, 150)}…` : result.excerpt;
  return (
    <div className="kanban-task search-result-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <span className="kanban-task__title">{title}</span>
      {date && <div className="kanban-task__meta"><span className="kanban-task__deadline">{date}</span></div>}
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.4 }}>{excerpt}</p>
    </div>
  );
}

export default function SearchPage() {
  const [query, setQuery]         = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects]   = useState<Project[]>([]);
  const [activeTab, setActiveTab] = useState<'tasks' | 'conversations'>('tasks');

  const [taskResults, setTaskResults]     = useState<Task[]>([]);
  const [convResults, setConvResults]     = useState<ConversationSearchResult[]>([]);
  const [searching, setSearching]         = useState(false);
  const [searched, setSearched]           = useState(false);
  const [error, setError]                 = useState<string | null>(null);

  const inputRef    = useRef<HTMLInputElement>(null);
  const navigate    = useNavigate();
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
      setTaskResults([]);
      setConvResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setSearching(true);
      setError(null);
      Promise.all([
        searchItems(query.trim(), projectId || undefined),
        searchConversations(query.trim()),
      ])
        .then(([tasks, convs]) => {
          setTaskResults(tasks);
          setConvResults(convs);
          setSearched(true);
        })
        .catch((e: unknown) => setError((e as Error).message))
        .finally(() => setSearching(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, projectId]);

  const taskCount = taskResults.length;
  const convCount = convResults.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <h1 className="page-title">Search</h1>
        <p className="page-subtitle">Find tasks and past conversations.</p>
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
              placeholder="Search tasks and conversations…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          {activeTab === 'tasks' && (
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
          )}
        </div>

        {/* Tab bar */}
        <div className="filter-pills" style={{ marginBottom: '12px' }}>
          <button
            className={`filter-pill${activeTab === 'tasks' ? ' filter-pill--active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            Tasks{searched && taskCount > 0 ? ` (${taskCount})` : ''}
          </button>
          <button
            className={`filter-pill${activeTab === 'conversations' ? ' filter-pill--active' : ''}`}
            onClick={() => setActiveTab('conversations')}
          >
            Conversations{searched && convCount > 0 ? ` (${convCount})` : ''}
          </button>
        </div>

        {error && <div className="page-error">{error}</div>}

        {!query.trim() && (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">Type to search</p>
            <p className="empty-state__body">Search across task titles, descriptions, tags, and past conversation turns.</p>
          </div>
        )}

        {searching && <div className="page-loading">Searching…</div>}

        {/* Tasks tab results */}
        {activeTab === 'tasks' && !searching && searched && taskResults.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">No results</p>
            <p className="empty-state__body">No tasks found for "{query}".</p>
          </div>
        )}

        {activeTab === 'tasks' && !searching && taskResults.length > 0 && (
          <div className="search-results">
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              {taskCount} result{taskCount !== 1 ? 's' : ''}
            </div>
            <div className="search-results__list">
              {taskResults.map(t => (
                <SearchTaskCard
                  key={t.id}
                  task={t}
                  onClick={() => navigate(`/tasks/${t.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Conversations tab results */}
        {activeTab === 'conversations' && !searching && searched && convResults.length === 0 && (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="search" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">No results</p>
            <p className="empty-state__body">No conversation turns found for "{query}".</p>
          </div>
        )}

        {activeTab === 'conversations' && !searching && convResults.length > 0 && (
          <div className="search-results">
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
              {convCount} result{convCount !== 1 ? 's' : ''}
            </div>
            <div className="search-results__list">
              {convResults.map(r => (
                <ConversationResultCard
                  key={r.turnId}
                  result={r}
                  onClick={() => navigate('/activity')}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
