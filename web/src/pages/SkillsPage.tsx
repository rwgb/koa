import { useState, useEffect } from 'react';
import type { InstalledSkill, MarketplaceSkill, CustomSkillDef } from '../types.js';
import type { IconName } from '../components/Icon.js';
import { Icon } from '../components/Icon.js';
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

// ── Template presets ──────────────────────────────────────────────────────────

const TEMPLATES: { label: string; form: Partial<FormState> }[] = [
  {
    label: 'HTTP Webhook',
    form: {
      type: 'http',
      url: 'https://hooks.example.com/trigger',
      method: 'POST',
      description: 'Trigger an HTTP webhook with a POST request.',
    },
  },
  {
    label: 'Bash Script',
    form: {
      type: 'bash',
      command: 'bash /path/to/script.sh {{input.message}}',
      description: 'Run a local bash script with optional parameters.',
    },
  },
  {
    label: 'JSON Parser',
    form: {
      type: 'bash',
      command: "echo '{{input.json}}' | jq '.'",
      description: 'Parse and pretty-print a JSON string using jq.',
    },
  },
];

// ── Icon mapping for marketplace skills ───────────────────────────────────────

const SKILL_ICONS: Record<string, IconName> = {
  search:      'search',
  chat:        'chat',
  notify:      'bell',
  mail:        'envelope',
  webhook:     'link',
  server:      'server',
  shield:      'shield',
  home:        'folder',
  default:     'wrench',
};

function skillIcon(name: string): IconName {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(SKILL_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return SKILL_ICONS.default!;
}

function buildConfig(form: FormState): Record<string, string> {
  if (form.type === 'bash') return { command: form.command };
  if (form.type === 'http') return { url: form.url, method: form.method };
  return { serverName: form.serverName, toolName: form.toolName };
}

// ── Installed skills table ────────────────────────────────────────────────────

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
              <span className={s.source === 'custom' ? 'badge badge-blue' : 'badge badge-muted'}>
                {s.source}
              </span>
            </td>
            <td>
              <span className="badge badge-green">Active</span>
            </td>
            <td>
              {s.source === 'custom' && (
                confirmName === s.name ? (
                  <span className="skill-confirm-row">
                    <span className="skill-confirm-label">Delete?</span>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => { onDelete(s.name); setConfirmName(null); }}
                    >
                      Yes
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmName(null)}
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <button
                    className="btn btn-danger btn-sm"
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

// ── Marketplace grid ──────────────────────────────────────────────────────────

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
        <div key={s.name} className="card skill-card">
          <div className="card-header" style={{ marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name={skillIcon(s.name)} size={16} aria-hidden />
              <span className="card-title">{s.name}</span>
            </div>
          </div>
          <p className="skill-card__desc">{s.description}</p>
          <div className="skill-card__requires">
            {s.requires.length === 0 ? (
              <span className="skill-chip">No requirements</span>
            ) : (
              s.requires.map((r) => (
                <span key={r} className="skill-chip">{r}</span>
              ))
            )}
          </div>
          <button className="btn btn-primary btn-sm" style={{ marginTop: '8px', alignSelf: 'flex-start' }} onClick={() => onInstall(s)}>
            Install
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Skill builder ─────────────────────────────────────────────────────────────

function SkillBuilder({
  initialForm,
  onSave,
  onCancel,
}: {
  initialForm: FormState;
  onSave: (skill: CustomSkillDef) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm]     = useState<FormState>(initialForm);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const nameValid = /^[a-z][a-z0-9_]{1,49}$/.test(form.name);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function applyTemplate(tmpl: Partial<FormState>) {
    setForm(prev => ({ ...prev, ...tmpl }));
    setNotice(null);
    setError(null);
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
        name:        form.name,
        description: form.description,
        type:        form.type,
        config:      buildConfig(form),
        createdAt:   new Date().toISOString(),
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
      {/* Templates */}
      <div style={{ marginBottom: '16px' }}>
        <label className="form-label">Start from template</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {TEMPLATES.map(t => (
            <button key={t.label} className="btn btn-secondary btn-sm" onClick={() => applyTemplate(t.form)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {notice && <div className="skill-notice">{notice}</div>}
      {error  && <div className="skill-notice skill-notice--error">{error}</div>}

      <div className="form-group">
        <label className="form-label" htmlFor="skill-name">Name</label>
        <input
          id="skill-name"
          className="form-input"
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

      <div className="form-group">
        <label className="form-label" htmlFor="skill-desc">Description</label>
        <textarea
          id="skill-desc"
          className="form-textarea"
          rows={2}
          value={form.description}
          placeholder="What does this skill do?"
          onChange={(e) => set('description', e.target.value)}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor="skill-type">Type</label>
        <select
          id="skill-type"
          className="form-select"
          value={form.type}
          onChange={(e) => set('type', e.target.value as SkillType)}
        >
          <option value="bash">bash</option>
          <option value="http">http</option>
          <option value="mcp">mcp</option>
        </select>
      </div>

      {form.type === 'bash' && (
        <div className="form-group">
          <label className="form-label" htmlFor="skill-cmd">Command template</label>
          <textarea
            id="skill-cmd"
            className="form-textarea"
            rows={3}
            value={form.command}
            placeholder="e.g. echo {{input.message}}"
            onChange={(e) => set('command', e.target.value)}
          />
          <span className="skill-form-hint">Use {'{{input.fieldName}}'} for parameters</span>
        </div>
      )}

      {form.type === 'http' && (
        <div className="form-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="skill-url">URL</label>
            <input
              id="skill-url"
              className="form-input"
              type="text"
              value={form.url}
              placeholder="https://api.example.com/endpoint"
              onChange={(e) => set('url', e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="skill-method">Method</label>
            <select
              id="skill-method"
              className="form-select"
              value={form.method}
              onChange={(e) => set('method', e.target.value as 'GET' | 'POST' | 'PUT')}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
            </select>
          </div>
        </div>
      )}

      {form.type === 'mcp' && (
        <div className="form-row">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="skill-server">Server name</label>
            <input
              id="skill-server"
              className="form-input"
              type="text"
              value={form.serverName}
              placeholder="e.g. my_mcp_server"
              onChange={(e) => set('serverName', e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="skill-tool">Tool name</label>
            <input
              id="skill-tool"
              className="form-input"
              type="text"
              value={form.toolName}
              placeholder="e.g. run_query"
              onChange={(e) => set('toolName', e.target.value)}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          className="btn btn-primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Skill'}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [installed, setInstalled]     = useState<InstalledSkill[]>([]);
  const [marketplace, setMarketplace] = useState<MarketplaceSkill[]>([]);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState<string | null>(null);
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
    return <div className="page-loading">Loading skills…</div>;
  }

  if (loadError) {
    return (
      <div className="skill-page">
        <div className="skill-notice skill-notice--error">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="page-body" style={{ height: '100%' }}>
      {/* Installed */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">
            Installed Skills
            <span className="badge badge-blue" style={{ marginLeft: '8px', verticalAlign: 'middle' }}>{installed.length}</span>
          </span>
        </div>
        {installed.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No skills installed.</p>
        ) : (
          <InstalledTable skills={installed} onDelete={(name) => void handleDelete(name)} />
        )}
      </div>

      {/* Marketplace */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Skill Marketplace</span>
        </div>
        {marketplace.length === 0 ? (
          <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>All marketplace skills are already installed.</p>
        ) : (
          <MarketplaceGrid skills={marketplace} onInstall={handleInstall} />
        )}
      </div>

      {/* Custom Skill Builder */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Custom Skill Builder</span>
          {!builderOpen && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ borderStyle: 'dashed', color: 'var(--purple)', borderColor: 'color-mix(in srgb, var(--purple) 50%, var(--border))' }}
              onClick={() => { setBuilderForm(EMPTY_FORM); setBuilderOpen(true); }}
            >
              + New Custom Skill
            </button>
          )}
        </div>
        {builderOpen && (
          <SkillBuilder
            initialForm={builderForm}
            onSave={handleSave}
            onCancel={() => { setBuilderOpen(false); setBuilderForm(EMPTY_FORM); }}
          />
        )}
      </div>
    </div>
  );
}
