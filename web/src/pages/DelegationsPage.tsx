import { useEffect, useState } from 'react';
import {
  fetchDelegations,
  createDelegationApi,
  updateDelegationApi,
  deleteDelegationApi,
} from '../api.js';
import type { DelegationRecord } from '../api.js';

interface DelegationForm {
  pattern: string;
  action: string;
  schedule: string;
}

const SCHEDULE_OPTIONS = [
  'daily', 'weekly', 'monthly',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

export default function DelegationsPage() {
  const [delegations, setDelegations] = useState<DelegationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DelegationRecord | null>(null);
  const [form, setForm] = useState<DelegationForm>({ pattern: '', action: '', schedule: 'daily' });
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const data = await fetchDelegations();
      setDelegations(data);
    } catch {
      setError('Failed to load delegations');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm({ pattern: '', action: '', schedule: 'daily' });
    setShowModal(true);
  }

  function openEdit(d: DelegationRecord) {
    setEditing(d);
    setForm({ pattern: d.pattern, action: d.action, schedule: d.schedule });
    setShowModal(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing) {
        await updateDelegationApi(editing.id, form);
      } else {
        await createDelegationApi(form);
      }
      setShowModal(false);
      await load();
    } catch {
      setError('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(d: DelegationRecord) {
    try {
      await updateDelegationApi(d.id, { enabled: d.enabled === 0 });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this delegation?')) return;
    try {
      await deleteDelegationApi(id);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Standing Delegations</h1>
        <button className="btn btn-primary" onClick={openAdd}>+ Add delegation</button>
      </div>

      {error && (
        <div className="error-banner">
          <span className="error-text">{error}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : delegations.length === 0 ? (
        <div className="empty-state">
          <p>No delegations yet. Create one to automate recurring agent actions.</p>
        </div>
      ) : (
        <div className="card-list">
          {delegations.map(d => (
            <div key={d.id} className={`card ${d.enabled ? '' : 'card--muted'}`}>
              <div className="card-header">
                <div>
                  <div className="card-title">{d.action.length > 80 ? d.action.slice(0, 80) + '…' : d.action}</div>
                  {d.pattern && <div className="card-subtitle">Trigger: {d.pattern}</div>}
                </div>
                <div className="card-actions">
                  <span className="badge">{d.schedule}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => openEdit(d)}>Edit</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void toggleEnabled(d)}>
                    {d.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn btn-sm btn-ghost btn-danger" onClick={() => void handleDelete(d.id)}>Delete</button>
                </div>
              </div>
              {d.last_run && (
                <div className="card-meta">Last run: {new Date(d.last_run).toLocaleString()}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editing ? 'Edit delegation' : 'Add delegation'}</h2>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <form onSubmit={(e) => void handleSave(e)}>
              <div className="form-group">
                <label className="form-label">Action (what Koa will do)</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={form.action}
                  onChange={e => setForm(f => ({ ...f, action: e.target.value }))}
                  placeholder="e.g. Review open GitHub PRs and summarise any requiring attention"
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">Schedule</label>
                <select
                  className="form-input"
                  value={form.schedule}
                  onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))}
                >
                  {SCHEDULE_OPTIONS.map(s => (
                    <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Pattern (optional label/trigger keyword)</label>
                <input
                  className="form-input"
                  value={form.pattern}
                  onChange={e => setForm(f => ({ ...f, pattern: e.target.value }))}
                  placeholder="e.g. review team PRs"
                />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
