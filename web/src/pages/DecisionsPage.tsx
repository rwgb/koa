import { useEffect, useState } from 'react';
import { fetchDecisions, fetchProjects, createDecision } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { Decision, Project } from '../types.js';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function DecisionRow({ decision, projectName }: { decision: Decision; projectName: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card" style={{ padding: '0', overflow: 'hidden', marginBottom: '8px' }}>
      <button
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto auto auto',
          gap: '12px',
          alignItems: 'center',
          width: '100%',
          background: 'none',
          border: 'none',
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: '13px',
          padding: '14px 16px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        <span style={{ fontWeight: 600 }}>{decision.title}</span>
        <span className="badge badge-muted" style={{ fontSize: '11px' }}>{projectName}</span>
        <span className="badge badge-blue" style={{ fontSize: '11px' }}>{decision.chosen}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatDate(decision.created_at)}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
        </span>
      </button>
      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {decision.context && (
            <div>
              <span className="section-title" style={{ display: 'block', marginBottom: '4px' }}>Context</span>
              <p style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.5', margin: 0 }}>{decision.context}</p>
            </div>
          )}
          {decision.options.length > 0 && (
            <div>
              <span className="section-title" style={{ display: 'block', marginBottom: '4px' }}>Options considered</span>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '4px' }}>
                {decision.options.map((o, i) => (
                  <li key={i} style={{ fontSize: '13px', color: o === decision.chosen ? 'var(--green)' : 'var(--text)' }}>
                    {o === decision.chosen ? '> ' : '  '}{o}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {decision.rationale && (
            <div>
              <span className="section-title" style={{ display: 'block', marginBottom: '4px' }}>Rationale</span>
              <p style={{ fontSize: '13px', color: 'var(--text)', lineHeight: '1.5', margin: 0 }}>{decision.rationale}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DecisionsPage() {
  const [decisions, setDecisions]     = useState<Decision[]>([]);
  const [projects, setProjects]       = useState<Project[]>([]);
  const [filterProject, setFilterProject] = useState('');
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  // Modal state
  const [showModal, setShowModal]     = useState(false);
  const [formProject, setFormProject] = useState('');
  const [formTitle, setFormTitle]     = useState('');
  const [formContext, setFormContext]  = useState('');
  const [formChosen, setFormChosen]   = useState('');
  const [formRationale, setFormRationale] = useState('');
  const [formOptions, setFormOptions] = useState('');
  const [creating, setCreating]       = useState(false);
  const [formError, setFormError]     = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [d, p] = await Promise.all([fetchDecisions(), fetchProjects()]);
        setDecisions(d);
        setProjects(p);
        if (p.length > 0 && !formProject) setFormProject(p[0].id);
      } catch (e: unknown) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function openModal() {
    setFormTitle('');
    setFormContext('');
    setFormChosen('');
    setFormRationale('');
    setFormOptions('');
    setFormError(null);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setFormError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formProject || !formTitle.trim() || !formChosen.trim()) return;
    setCreating(true);
    setFormError(null);
    try {
      const d = await createDecision({
        projectId: formProject,
        title:     formTitle.trim(),
        context:   formContext.trim(),
        chosen:    formChosen.trim(),
        rationale: formRationale.trim(),
        options:   formOptions.split(',').map(o => o.trim()).filter(Boolean),
      });
      setDecisions(prev => [d, ...prev]);
      closeModal();
    } catch (e: unknown) {
      setFormError((e as Error).message);
    } finally {
      setCreating(false);
    }
  }

  const projectName = (id: string) => projects.find(p => p.id === id)?.name ?? id;
  const visible = filterProject
    ? decisions.filter(d => d.project_id === filterProject)
    : decisions;

  if (loading) return <div className="page-loading">Loading…</div>;
  if (error)   return <div className="page-error">Error: {error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Decisions</h1>
          <p className="page-subtitle">Architecture choices and design rationale.</p>
        </div>
        <button className="btn btn-primary" onClick={openModal} style={{ marginTop: '4px' }}>
          + Record Decision
        </button>
      </div>

      <div className="page-body">
        {/* Filter */}
        <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label className="form-label" style={{ margin: 0 }}>Filter by project</label>
          <select
            className="form-select"
            style={{ width: 'auto', minWidth: '180px' }}
            value={filterProject}
            onChange={e => setFilterProject(e.target.value)}
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {visible.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon">
              <Icon name="database" size={40} aria-hidden />
            </div>
            <p className="empty-state__title">No decisions yet</p>
            <p className="empty-state__body">Record architectural choices and rationale for future reference.</p>
            <button className="btn btn-primary btn-sm" onClick={openModal}>+ Record Decision</button>
          </div>
        ) : (
          <div>
            {visible.map(d => (
              <DecisionRow key={d.id} decision={d} projectName={projectName(d.project_id)} />
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal" style={{ maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Record Decision</h2>
              <button className="btn btn-ghost btn-sm" onClick={closeModal} aria-label="Close">
                <Icon name="x" size={14} />
              </button>
            </div>

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label" htmlFor="dec-project">Project</label>
                <select id="dec-project" className="form-select" value={formProject} onChange={e => setFormProject(e.target.value)} required>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="dec-title">Title</label>
                <input id="dec-title" className="form-input" type="text" placeholder="Decision title" value={formTitle} onChange={e => setFormTitle(e.target.value)} required autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="dec-context">Context</label>
                <textarea id="dec-context" className="form-textarea" placeholder="Background and problem statement" value={formContext} onChange={e => setFormContext(e.target.value)} rows={2} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="dec-options">Options (comma-separated)</label>
                <input id="dec-options" className="form-input" type="text" placeholder="Option A, Option B, Option C" value={formOptions} onChange={e => setFormOptions(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="dec-chosen">Chosen option</label>
                <input id="dec-chosen" className="form-input" type="text" placeholder="The chosen option" value={formChosen} onChange={e => setFormChosen(e.target.value)} required />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="dec-rationale">Rationale</label>
                <textarea id="dec-rationale" className="form-textarea" placeholder="Why this option was chosen" value={formRationale} onChange={e => setFormRationale(e.target.value)} rows={2} />
              </div>
              {formError && <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '8px' }}>{formError}</p>}
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating || !formTitle.trim() || !formChosen.trim()}>
                  {creating ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
