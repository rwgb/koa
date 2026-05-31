import { useEffect, useState, useCallback } from 'react';
import {
  fetchMemoryEngram,
  fetchMemoryFiles,
  updateMemoryFile,
  fetchFacts,
  addFact,
  deleteFact,
  rebuildBrain,
} from '../api.js';
import type { EngramMemoryResponse, MemoryFilesResponse, MemoryEntry } from '../types.js';

// ── Engram Panel ─────────────────────────────────────────────────────────────

function EngramPanel({ data }: { data: EngramMemoryResponse }) {
  const { engram, spiderBrain, engramEnabled } = data;

  return (
    <section className="mem-section">
      <div className="mem-section__header">
        <h2 className="mem-section__title">Engram Brain</h2>
        <span className={`mem-badge ${engramEnabled ? 'mem-badge--on' : 'mem-badge--off'}`}>
          {engramEnabled ? 'online' : 'offline'}
        </span>
      </div>

      {engram.goal && (
        <div className="mem-field">
          <span className="mem-field__label">Session goal</span>
          <span className="mem-field__value">{engram.goal}</span>
        </div>
      )}

      {engram.sessionSummary && (
        <div className="mem-field">
          <span className="mem-field__label">Last session</span>
          <span className="mem-field__value mem-field__value--muted">{engram.sessionSummary}</span>
        </div>
      )}

      {engram.hotFiles.length > 0 && (
        <div className="mem-subsection">
          <h3 className="mem-subsection__title">Hot files</h3>
          <ul className="mem-file-list">
            {engram.hotFiles.map((f) => (
              <li key={f.path} className="mem-file-list__item">
                <span className="mem-file-list__path">{f.path}</span>
                <span className="mem-file-list__score">{f.score.toFixed(1)}</span>
                {f.cluster && (
                  <span className="mem-file-list__cluster">{f.cluster}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {engram.masterFiles.length > 0 && (
        <div className="mem-subsection">
          <h3 className="mem-subsection__title">Master files</h3>
          <ul className="mem-master-list">
            {engram.masterFiles.map((f) => (
              <li key={f} className="mem-master-list__item">{f}</li>
            ))}
          </ul>
        </div>
      )}

      {spiderBrain && spiderBrain.available && (
        <div className="mem-subsection">
          <h3 className="mem-subsection__title">SpiderBrain masters</h3>
          <ul className="mem-file-list">
            {spiderBrain.masters.slice(0, 8).map((m) => (
              <li key={m.id} className="mem-file-list__item">
                <span className="mem-file-list__path">{m.id}</span>
                <span className="mem-file-list__score">{m.webscore.toFixed(1)}</span>
                <span className="mem-file-list__cluster">{m.cluster}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── Project Files Panel ──────────────────────────────────────────────────────

const FILE_TABS = ['PROJECT', 'STATE', 'BACKLOG', 'HANDOFF'] as const;
type FileTab = (typeof FILE_TABS)[number];

function ProjectFilesPanel({ data, onRefresh }: { data: MemoryFilesResponse; onRefresh: () => void }) {
  const [active, setActive] = useState<FileTab>('STATE');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentContent = data.files[active]?.content;

  function startEdit() {
    setDraft(currentContent ?? '');
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await updateMemoryFile(active, draft);
      setEditing(false);
      onRefresh();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mem-section">
      <div className="mem-section__header">
        <h2 className="mem-section__title">Project Memory Files</h2>
        <span className="mem-field__value--muted" style={{ fontSize: '11px' }}>{data.dir}</span>
      </div>

      <div className="mem-tabs">
        {FILE_TABS.map((tab) => (
          <button
            key={tab}
            className={`mem-tab ${active === tab ? 'mem-tab--active' : ''}`}
            onClick={() => { setActive(tab); setEditing(false); }}
          >
            {tab}.md
            {data.files[tab]?.content === null && (
              <span className="mem-tab__empty"> ∅</span>
            )}
          </button>
        ))}
      </div>

      <div className="mem-file-content">
        {editing ? (
          <>
            <textarea
              className="mem-editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={20}
            />
            {saveError && <div className="mem-error">{saveError}</div>}
            <div className="mem-file-actions">
              <button className="mem-btn mem-btn--primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="mem-btn" onClick={cancelEdit} disabled={saving}>Cancel</button>
            </div>
          </>
        ) : currentContent !== null ? (
          <>
            <pre className="mem-code">{currentContent}</pre>
            <div className="mem-file-actions">
              <button className="mem-btn mem-btn--primary" onClick={startEdit}>Edit</button>
            </div>
          </>
        ) : (
          <div className="mem-empty">
            <span className="mem-empty__text">No {active}.md yet.</span>
            <button className="mem-btn mem-btn--primary" onClick={startEdit}>Create</button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Facts Panel ──────────────────────────────────────────────────────────────

function FactsPanel() {
  const [facts, setFacts] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newFact, setNewFact] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchFacts()
      .then(setFacts)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!newFact.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addFact(newFact.trim());
      setNewFact('');
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(fact: string) {
    try {
      await deleteFact(fact);
      setConfirmDelete(null);
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="mem-section">
      <div className="mem-section__header">
        <h2 className="mem-section__title">Persistent Facts</h2>
        <span className="mem-field__value--muted">{facts.length} stored</span>
      </div>

      {error && <div className="mem-error">{error}</div>}

      <div className="mem-add-fact">
        <input
          className="mem-input"
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          placeholder="Add a fact…"
          disabled={adding}
        />
        <button className="mem-btn mem-btn--primary" onClick={handleAdd} disabled={adding || !newFact.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>

      {loading ? (
        <div className="mem-empty__text">Loading…</div>
      ) : facts.length === 0 ? (
        <div className="mem-empty__text">No facts stored yet.</div>
      ) : (
        <ul className="mem-facts-list">
          {[...facts].reverse().map((entry) => (
            <li key={entry.timestamp + entry.fact} className="mem-fact-item">
              <span className="mem-fact-item__text">{entry.fact}</span>
              <span className="mem-fact-item__date">
                {new Date(entry.timestamp).toLocaleDateString()}
              </span>
              {confirmDelete === entry.fact ? (
                <span className="mem-fact-item__confirm">
                  Delete?{' '}
                  <button className="mem-btn mem-btn--danger mem-btn--xs" onClick={() => handleDelete(entry.fact)}>Yes</button>
                  {' '}
                  <button className="mem-btn mem-btn--xs" onClick={() => setConfirmDelete(null)}>No</button>
                </span>
              ) : (
                <button
                  className="mem-fact-item__delete"
                  onClick={() => setConfirmDelete(entry.fact)}
                  title="Delete fact"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function MemoryPage() {
  const [engram, setEngram] = useState<EngramMemoryResponse | null>(null);
  const [files, setFiles] = useState<MemoryFilesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildMsg, setRebuildMsg] = useState<string | null>(null);

  const loadEngram = useCallback(() => {
    fetchMemoryEngram().then(setEngram).catch((err) => setError((err as Error).message));
  }, []);

  const loadFiles = useCallback(() => {
    fetchMemoryFiles().then(setFiles).catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    loadEngram();
    loadFiles();
  }, [loadEngram, loadFiles]);

  async function handleRebuild() {
    setRebuilding(true);
    setRebuildMsg(null);
    try {
      const out = await rebuildBrain();
      setRebuildMsg(out || 'Brain rebuilt successfully.');
      loadEngram();
    } catch (err) {
      setRebuildMsg(`Error: ${(err as Error).message}`);
    } finally {
      setRebuilding(false);
    }
  }

  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="memory-page">
      <header className="page-header">
        <div className="page-header__row">
          <h1 className="page-title">Memory</h1>
          <div className="page-header__actions">
            <button className="mem-btn" onClick={handleRebuild} disabled={rebuilding}>
              {rebuilding ? 'Rebuilding…' : 'Rebuild brain'}
            </button>
          </div>
        </div>
        {rebuildMsg && <div className="mem-rebuild-msg">{rebuildMsg}</div>}
      </header>

      <div className="memory-body">
        {engram ? <EngramPanel data={engram} /> : <div className="page-loading">Loading brain…</div>}
        {files ? <ProjectFilesPanel data={files} onRefresh={loadFiles} /> : <div className="page-loading">Loading files…</div>}
        <FactsPanel />
      </div>
    </div>
  );
}
