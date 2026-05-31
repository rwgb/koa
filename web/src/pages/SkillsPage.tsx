import { useState, useEffect } from 'react';
import type { InstalledSkill, MarketplaceSkill, CustomSkillDef } from '../types.js';
import {
  fetchSkills,
  saveCustomSkill,
  deleteCustomSkill,
} from '../api.js';

type SkillType = 'bash' | 'http' | 'mcp';

interface FormState {
  name: string;
  description: string;
  type: SkillType;
  command: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  serverName: string;
  toolName: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  type: 'bash',
  command: '',
  url: '',
  method: 'GET',
  serverName: '',
  toolName: '',
};

function buildConfig(form: FormState): Record<string, string> {
  if (form.type === 'bash') return { command: form.command };
  if (form.type === 'http') return { url: form.url, method: form.method };
  return { serverName: form.serverName, toolName: form.toolName };
}

function InstalledTable({
  skills,
  onDelete,
}: {
  skills: InstalledSkill[];
  onDelete: (name: string) => void;
}) {
  const [confirmName, setConfirmName] = useState<string | null>(null);

  return (
    <table className="skill-table">
      <thead>
        <tr>
          <th>Skill</th>
          <th>Source</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {skills.map((s) => (
          <tr key={s.name}>
            <td>
              <span className="skill-name">{s.name}</span>
              {s.description && (
                <span className="skill-desc">{s.description}</span>
              )}
            </td>
            <td>
              <span
                className={
                  s.source === 'custom'
                    ? 'skill-badge skill-badge--custom'
                    : 'skill-badge skill-badge--builtin'
                }
              >
                {s.source}
              </span>
            </td>
            <td>
              <span className="skill-badge skill-badge--active">Active</span>
            </td>
            <td>
              {s.source === 'custom' && (
                confirmName === s.name ? (
                  <span className="skill-confirm-row">
                    <span className="skill-confirm-label">Delete?</span>
                    <button
                      className="skill-action-btn skill-action-btn--danger"
                      onClick={() => { onDelete(s.name); setConfirmName(null); }}
                    >
                      Yes
                    </button>
                    <button
                      className="skill-action-btn"
                      onClick={() => setConfirmName(null)}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    className="skill-action-btn skill-action-btn--danger"
                    onClick={() => setConfirmName(s.name)}
                  >
                    Delete
                  </button>
                )
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MarketplaceGrid({
  skills,
  onInstall,
}: {
  skills: MarketplaceSkill[];
  onInstall: (s: MarketplaceSkill) => void;
}) {
  return (
    <div className="skill-marketplace">
      {skills.map((s) => (
        <div key={s.name} className="skill-card">
          <div className="skill-card__icon">{s.icon}</div>
          <div className="skill-card__name">{s.name}</div>
          <div className="skill-card__desc">{s.description}</div>
          <div className="skill-card__requires">
            {s.requires.length === 0 ? (
              <span className="skill-chip">No requirements</span>
            ) : (
              s.requires.map((r) => (
                <span key={r} className="skill-chip">{r}</span>
              ))
            )}
          </div>
          <button className="skill-install-btn" onClick={() => onInstall(s)}>
            Install
          </button>
        </div>
      ))}
    </div>
  );
}

function SkillBuilder({
  initialForm,
  onSave,
  onCancel,
}: {
  initialForm: FormState;
  onSave: (skill: CustomSkillDef) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const nameValid = /^[a-z][a-z0-9_]{1,49}$/.test(form.name);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!nameValid) {
      setError('Name must match: [a-z][a-z0-9_]{1,49}');
      return;
    }
    if (!form.description.trim()) {
      setError('Description is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const skill: CustomSkillDef = {
        name: form.name,
        description: form.description,
        type: form.type,
        config: buildConfig(form),
        createdAt: new Date().toISOString(),
      };
      await onSave(skill);
      setNotice('Skill saved. Restart Koa server to activate.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="skill-builder__form">
      {notice && <div className="skill-notice">{notice}</div>}
      {error && <div className="skill-notice skill-notice--error">{error}</div>}

      <div className="skill-form-row">
        <label className="skill-form-label">Name</label>
        <input
          className="skill-form-input"
          type="text"
          value={form.name}
          placeholder="e.g. my_skill"
          pattern="[a-z][a-z0-9_]{1,49}"
          onChange={(e) => set('name', e.target.value)}
        />
        {form.name && !nameValid && (
          <span className="skill-form-hint skill-form-hint--error">
            Must start with a-z, then a-z0-9_ (2–50 chars)
          </span>
        )}
      </div>

      <div className="skill-form-row">
        <label className="skill-form-label">Description</label>
        <textarea
          className="skill-form-input skill-form-textarea"
          rows={1}
          value={form.description}
          placeholder="What does this skill do?"
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div className="skill-form-row">
        <label className="skill-form-label">Type</label>
        <select
          className="skill-form-input skill-form-select"
          value={form.type}
          onChange={(e) => set('type', e.target.value as SkillType)}
        >
          <option value="bash">bash</option>
          <option value="http">http</option>
          <option value="mcp">mcp</option>
        </select>
      </div>

      {form.type === 'bash' && (
        <div className="skill-form-row">
          <label className="skill-form-label">Command template</label>
          <textarea
            className="skill-form-input skill-form-textarea"
            rows={3}
            value={form.command}
            placeholder="e.g. echo {{input.message}}"
            onChange={(e) => set('command', e.target.value)}
          />
          <span className="skill-form-hint">
            Use {'{{input.fieldName}}'} for parameters
          </span>
        </div>
      )}

      {form.type === 'http' && (
        <>
          <div className="skill-form-row">
            <label className="skill-form-label">URL</label>
            <input
              className="skill-form-input"
              type="text"
              value={form.url}
              placeholder="https://api.example.com/endpoint"
              onChange={(e) => set('url', e.target.value)}
            />
          </div>
          <div className="skill-form-row">
            <label className="skill-form-label">Method</label>
            <select
              className="skill-form-input skill-form-select"
              value={form.method}
              onChange={(e) => set('method', e.target.value as 'GET' | 'POST' | 'PUT')}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </div>
        </>
      )}

      {form.type === 'mcp' && (
        <>
          <div className="skill-form-row">
            <label className="skill-form-label">Server name</label>
            <input
              className="skill-form-input"
              type="text"
              value={form.serverName}
              placeholder="e.g. my_mcp_server"
              onChange={(e) => set('serverName', e.target.value)}
            />
          </div>
          <div className="skill-form-row">
            <label className="skill-form-label">Tool name</label>
            <input
              className="skill-form-input"
              type="text"
              value={form.toolName}
              placeholder="e.g. run_query"
              onChange={(e) => set('toolName', e.target.value)}
            />
          </div>
        </>
      )}

      <div className="skill-form-actions">
        <button
          className="skill-form-btn skill-form-btn--primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Skill'}
        </button>
        <button className="skill-form-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderForm, setBuilderForm] = useState<FormState>(EMPTY_FORM);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchSkills();
      setInstalled(data.installed);
      setMarketplace(data.marketplace);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleDelete(name: string) {
    await deleteCustomSkill(name);
    await load();
  }

  async function handleSave(skill: CustomSkillDef) {
    await saveCustomSkill(skill);
    await load();
    setBuilderOpen(false);
    setBuilderForm(EMPTY_FORM);
  }

  function handleInstall(s: MarketplaceSkill) {
    setBuilderForm({
      ...EMPTY_FORM,
      name: s.name,
      description: s.description,
      type: 'bash',
    });
    setBuilderOpen(true);
  }

  if (loading) {
    return <div className="skill-page skill-loading">Loading skills...</div>;
  }

  if (loadError) {
    return (
      <div className="skill-page">
        <div className="skill-notice skill-notice--error">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="skill-page">
      <section className="skill-section">
        <div className="skill-section__header">
          <h2 className="skill-section__title">Installed Skills</h2>
          <span className="skill-section__count">{installed.length}</span>
        </div>
        {installed.length === 0 ? (
          <p className="skill-empty">No skills installed.</p>
        ) : (
          <InstalledTable skills={installed} onDelete={(name) => void handleDelete(name)} />
        )}
      </section>

      <section className="skill-section">
        <div className="skill-section__header">
          <h2 className="skill-section__title">Skill Marketplace</h2>
        </div>
        {marketplace.length === 0 ? (
          <p className="skill-empty">All marketplace skills are already installed.</p>
        ) : (
          <MarketplaceGrid skills={marketplace} onInstall={handleInstall} />
        )}
      </section>

      <section className="skill-section skill-builder">
        <div className="skill-section__header">
          {!builderOpen ? (
            <button
              className="skill-builder__trigger"
              onClick={() => { setBuilderForm(EMPTY_FORM); setBuilderOpen(true); }}
            >
              New Custom Skill +
            </button>
          ) : (
            <h2 className="skill-section__title">Custom Skill Builder</h2>
          )}
        </div>
        {builderOpen && (
          <SkillBuilder
            initialForm={builderForm}
            onSave={handleSave}
            onCancel={() => { setBuilderOpen(false); setBuilderForm(EMPTY_FORM); }}
          />
        )}
      </section>
    </div>
  );
}
