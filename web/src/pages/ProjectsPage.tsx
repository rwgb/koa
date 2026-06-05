import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchProjects, createProject } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Project, ProjectStatus } from '../types.js';

type Filter = 'all' | ProjectStatus;

function statusBadge(s: ProjectStatus) {
  if (s === 'active')   return <span className="badge badge-blue">Active</span>;
  if (s === 'done')     return <span className="badge badge-green">Done</span>;
  return <span className="badge badge-muted">Archived</span>;
}

function ProjectCard({ project }: { project: Project }) {
  const desc = project.description?.length > 120
    ? `${project.description.slice(0, 120)}…`
    : (project.description ?? '');

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text)' }}>{project.name}</span>
        {statusBadge(project.status)}
      </div>
      {desc && <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', margin: 0 }}>{desc}</p>}
      <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
        <Link to={`/projects/${project.id}`} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          View tasks
        </Link>
      </div>
    </div>
  );
}

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All',      value: 'all'      },
  { label: 'Active',   value: 'active'   },
  { label: 'Done',     value: 'done'     },
  { label: 'Archived', value: 'archived' },
];

export default function ProjectsPage() {
  const [projects, setProjects]   = useState<Project[]>([]);
  const [filter, setFilter]       = useState<Filter>('all');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName]     = useState('');
  const [newDesc, setNewDesc]     = useState('');
  const [creating, setCreating]   = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then(setProjects)
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function openModal() {
    setNewName('');
    setNewDesc('');
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setFormError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setFormError(null);
    try {
      const proj = await createProject(newName.trim(), newDesc.trim() || undefined);
      setProjects(prev => [proj, ...prev]);
      closeModal();
    } catch (e: unknown) {
      setFormError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error)   return <div className="page-error">Error: {error}</div>;

  const visible = filter === 'all' ? projects : projects.filter(p => p.status === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '16px', background: 'var(--bg-secondary)' }}>
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">Manage your projects and their tasks.</p>
        </div>
        <button className="btn btn-primary" onClick={openModal} style={{ marginTop: '4px' }}>
          + New Project
        </button>
      </div>

      <div className="page-body">
        <div className="filter-tabs">
          {FILTERS.map(f => (
            <button
              key={f.value}
              className={`filter-tab${filter === f.value ? ' filter-tab--active' : ''}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="folder" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">
              {filter === 'all' ? 'No projects yet' : `No ${filter} projects`}
            </p>
            <p className="empty-state__body">
              {filter === 'all'
                ? 'Create your first project to get started.'
                : `Switch the filter or create a new project.`}
            </p>
            {filter === 'all' && (
              <button className="btn btn-primary btn-sm" onClick={openModal}>
                + New Project
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
            {visible.map(p => <ProjectCard key={p.id} project={p} />)}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">New Project</h2>
              <button className="btn btn-ghost btn-sm" onClick={closeModal} aria-label="Close">
                <Icon name="x" size={14} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label" htmlFor="proj-name">Project name</label>
                <input
                  id="proj-name"
                  className="form-input"
                  type="text"
                  placeholder="e.g. Backend API"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="proj-desc">Description</label>
                <textarea
                  id="proj-desc"
                  className="form-textarea"
                  placeholder="Optional description"
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  rows={3}
                />
              </div>
              {formError && (
                <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '8px' }}>{formError}</p>
              )}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating || !newName.trim()}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
