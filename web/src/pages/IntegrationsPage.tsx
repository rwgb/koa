import { useEffect, useState, useRef } from 'react';
import {
  fetchIntegrations,
  saveIntegration,
  deleteIntegration,
  testIntegration,
} from '../api.js';
import type { Integration, IntegrationDef, IntegrationType } from '../types.js';
import { Icon } from '../components/Icon.js';

// ── Integration catalog ───────────────────────────────────────────────────────

const CATALOG: IntegrationDef[] = [
  {
    type: 'anthropic',
    name: 'Anthropic API',
    icon: 'anthropic',
    description: 'Core model API key and spend visibility.',
    fields: [{ key: 'apiKey', label: 'API Key', secret: true, placeholder: 'sk-ant-...' }],
  },
  {
    type: 'github',
    name: 'GitHub',
    icon: 'github',
    description: 'Repo access, PR and issue tools.',
    fields: [
      { key: 'token', label: 'Personal Access Token', secret: true, placeholder: 'ghp_...' },
      { key: 'defaultOwner', label: 'Default owner/org', secret: false, placeholder: 'rwgb' },
    ],
  },
  {
    type: 'slack',
    name: 'Slack',
    icon: 'chat',
    description: 'Incoming and outgoing notifications via Slack.',
    fields: [
      { key: 'webhookUrl', label: 'Incoming Webhook URL', secret: true, placeholder: 'https://hooks.slack.com/...' },
      { key: 'botToken', label: 'Bot Token (optional)', secret: true, placeholder: 'xoxb-...' },
      { key: 'defaultChannel', label: 'Default channel', secret: false, placeholder: '#koa' },
    ],
  },
  {
    type: 'pushover',
    name: 'Pushover',
    icon: 'phone',
    description: 'Mobile push alerts via Pushover.',
    fields: [
      { key: 'userKey', label: 'User Key', secret: true, placeholder: 'u...' },
      { key: 'appToken', label: 'App Token', secret: true, placeholder: 'a...' },
    ],
  },
  {
    type: 'ntfy',
    name: 'ntfy.sh',
    icon: 'bell',
    description: 'Push notifications via ntfy — no account required.',
    fields: [
      { key: 'topic', label: 'Topic', secret: false, placeholder: 'my_koa_topic' },
      { key: 'baseUrl', label: 'Server URL (optional)', secret: false, placeholder: 'https://ntfy.sh' },
    ],
  },
  {
    type: 'smtp',
    name: 'SMTP Email',
    icon: 'envelope',
    description: 'Email notifications via SMTP.',
    fields: [
      { key: 'host', label: 'SMTP Host', secret: false, placeholder: 'smtp.gmail.com' },
      { key: 'port', label: 'Port', secret: false, placeholder: '587' },
      { key: 'user', label: 'Username', secret: false, placeholder: 'you@gmail.com' },
      { key: 'password', label: 'Password', secret: true, placeholder: '' },
      { key: 'from', label: 'From address', secret: false, placeholder: 'koa@yourmail.com' },
    ],
  },
  {
    type: 'homelab',
    name: 'Homelab',
    icon: 'server',
    description: 'Custom homelab/vCenter endpoint for VM status tools.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', secret: false, placeholder: 'https://proxmox.local' },
      { key: 'token', label: 'API Token', secret: true, placeholder: '' },
    ],
  },
  {
    type: 'eset',
    name: 'ESET Web Analyzer',
    icon: 'shield',
    description: 'URL and file analysis via ESET Web Analyzer API.',
    fields: [
      { key: 'apiKey', label: 'API Key', secret: true, placeholder: '' },
      { key: 'baseUrl', label: 'Base URL', secret: false, placeholder: 'https://www.virustotal.com/api' },
    ],
  },
  {
    type: 'custom_http',
    name: 'Custom HTTP',
    icon: 'link',
    description: 'Generic webhook or REST endpoint with configurable auth.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', secret: false, placeholder: 'https://api.example.com' },
      { key: 'authHeader', label: 'Auth header name', secret: false, placeholder: 'Authorization' },
      { key: 'authValue', label: 'Auth header value', secret: true, placeholder: 'Bearer ...' },
    ],
  },
  {
    type: 'mcp_server',
    name: 'MCP Server',
    icon: 'gear',
    description: 'External Model Context Protocol tool server.',
    fields: [
      { key: 'serverUrl', label: 'Server URL', secret: false, placeholder: 'http://localhost:8080' },
      { key: 'authToken', label: 'Auth Token (optional)', secret: true, placeholder: '' },
    ],
  },
];

const CATALOG_MAP = new Map(CATALOG.map(d => [d.type, d]));

function statusBadge(status: string) {
  const cls =
    status === 'connected' ? 'intg-badge intg-badge--connected' :
    status === 'error'     ? 'intg-badge intg-badge--error' :
                             'intg-badge intg-badge--unconfigured';
  const label =
    status === 'connected' ? 'Connected' :
    status === 'error'     ? 'Error' :
                             'Not configured';
  return <span className={cls}>{label}</span>;
}

// ── Slide-over panel ──────────────────────────────────────────────────────────

interface SlideOverProps {
  def: IntegrationDef;
  integration: Integration | null; // null = new
  onClose: () => void;
  onSaved: (updated: Integration) => void;
  onDeleted: (id: string) => void;
}

function SlideOver({ def, integration, onClose, onSaved, onDeleted }: SlideOverProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of def.fields) {
      init[f.key] = integration?.config[f.key] ?? '';
    }
    return init;
  });
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const id = integration?.id ?? def.type;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveIntegration(id, { type: def.type, name: def.name, config: values });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!integration) return;
    if (!confirm(`Remove ${def.name} integration?`)) return;
    try {
      await deleteIntegration(id);
      onDeleted(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testIntegration(id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, message: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className="slide-over-backdrop" onClick={onClose} />
      <div className="slide-over slide-over--open" ref={panelRef}>
        <div className="slide-over__header">
          <span className="slide-over__icon"><Icon name={def.icon} size={18} /></span>
          <h2 className="slide-over__title">{def.name}</h2>
          <button className="slide-over__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        <div className="slide-over__body">
          <p className="slide-over__desc">{def.description}</p>

          {integration && (
            <div className="slide-over__status-row">
              {statusBadge(integration.status)}
              {integration.status === 'connected' && (
                <button
                  className="intg-btn intg-btn--ghost"
                  onClick={handleTest}
                  disabled={testing}
                >
                  {testing ? 'Testing…' : 'Test connection'}
                </button>
              )}
            </div>
          )}

          {testResult && (
            <div className={`slide-over__test-result ${testResult.ok ? 'slide-over__test-result--ok' : 'slide-over__test-result--fail'}`}>
              <Icon name={testResult.ok ? 'check' : 'alert'} size={13} />
              {testResult.message}
            </div>
          )}

          <div className="slide-over__fields">
            {def.fields.map(field => (
              <label key={field.key} className="intg-field">
                <span className="intg-field__label">{field.label}</span>
                <div className="intg-field__input-wrap">
                  <input
                    type={field.secret && !showSecret[field.key] ? 'password' : 'text'}
                    className="intg-field__input"
                    value={values[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                  />
                  {field.secret && (
                    <button
                      type="button"
                      className="intg-field__toggle"
                      onClick={() => setShowSecret(s => ({ ...s, [field.key]: !s[field.key] }))}
                      aria-label={showSecret[field.key] ? 'Hide' : 'Show'}
                    >
                      <Icon name={showSecret[field.key] ? 'eye-off' : 'eye'} size={14} />
                    </button>
                  )}
                </div>
                {field.hint && <span className="intg-field__hint">{field.hint}</span>}
              </label>
            ))}
          </div>

          {error && <div className="slide-over__error">{error}</div>}
        </div>

        <div className="slide-over__footer">
          {integration && integration.status === 'connected' && (
            <button className="intg-btn intg-btn--danger" onClick={handleDisconnect}>
              Disconnect
            </button>
          )}
          <div className="slide-over__footer-spacer" />
          <button className="intg-btn intg-btn--ghost" onClick={onClose}>Cancel</button>
          <button className="intg-btn intg-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Type picker modal ─────────────────────────────────────────────────────────

function TypePicker({
  existingTypes,
  onPick,
  onClose,
}: {
  existingTypes: Set<string>;
  onPick: (type: IntegrationType) => void;
  onClose: () => void;
}) {
  const available = CATALOG.filter(d => !existingTypes.has(d.type));
  return (
    <>
      <div className="slide-over-backdrop" onClick={onClose} />
      <div className="type-picker">
        <div className="type-picker__header">
          <h2>Add Integration</h2>
          <button className="slide-over__close" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>
        <div className="type-picker__list">
          {available.length === 0 && (
            <p className="type-picker__empty">All integration types are already added.</p>
          )}
          {available.map(d => (
            <button key={d.type} className="type-picker__item" onClick={() => onPick(d.type)}>
              <Icon name={d.icon} size={18} className="type-picker__icon" aria-hidden />
              <div className="type-picker__info">
                <span className="type-picker__name">{d.name}</span>
                <span className="type-picker__desc">{d.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── Integration card ──────────────────────────────────────────────────────────

function IntegrationCard({
  integration,
  onEdit,
}: {
  integration: Integration;
  onEdit: (integration: Integration) => void;
}) {
  const def = CATALOG_MAP.get(integration.type as IntegrationType);
  const icon = def?.icon ?? 'plug';
  const configSummary = Object.entries(integration.config)
    .filter(([, v]) => v && v !== '***')
    .map(([k, v]) => `${k}: ${v}`)
    .slice(0, 2)
    .join(' · ');

  return (
    <div className={`intg-card intg-card--${integration.status}`}>
      <div className="intg-card__top">
        <Icon name={icon as import('../components/Icon.js').IconName} size={20} className="intg-card__icon" aria-hidden />
        <div className="intg-card__info">
          <span className="intg-card__name">{integration.name}</span>
          {configSummary && <span className="intg-card__summary">{configSummary}</span>}
        </div>
        <button className="intg-card__edit" onClick={() => onEdit(integration)}>
          Edit
        </button>
      </div>
      <div className="intg-card__bottom">
        {statusBadge(integration.status)}
        {integration.errorMsg && (
          <span className="intg-card__error-msg">{integration.errorMsg}</span>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIntegration, setActiveIntegration] = useState<Integration | null | 'new'>(null);
  const [newType, setNewType] = useState<IntegrationType | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    fetchIntegrations()
      .then(setIntegrations)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  function handleEdit(integration: Integration) {
    setActiveIntegration(integration);
  }

  function handleAdd(type: IntegrationType) {
    setNewType(type);
    setShowPicker(false);
    setActiveIntegration('new');
  }

  function handleSaved(updated: Integration) {
    setIntegrations(prev => {
      const idx = prev.findIndex(i => i.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [...prev, updated];
    });
    setActiveIntegration(null);
    setNewType(null);
  }

  function handleDeleted(id: string) {
    setIntegrations(prev => prev.filter(i => i.id !== id));
    setActiveIntegration(null);
  }

  const existingTypes = new Set(integrations.map(i => i.type));
  const activeDef = activeIntegration === 'new' && newType
    ? CATALOG_MAP.get(newType)
    : activeIntegration && activeIntegration !== 'new'
      ? CATALOG_MAP.get(activeIntegration.type as IntegrationType)
      : null;

  if (loading) return <div className="page-loading">Loading integrations…</div>;
  if (error)   return <div className="page-error">Failed to load integrations: {error}</div>;

  return (
    <div className="intg-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-subtitle">Connect external services to unlock tools and notifications.</p>
        </div>
        <button className="intg-btn intg-btn--primary" onClick={() => setShowPicker(true)}>
          + Add
        </button>
      </header>

      {integrations.length === 0 ? (
        <div className="intg-empty">
          <Icon name="plug" size={32} className="intg-empty__icon" aria-hidden />
          <p>No integrations configured yet.</p>
          <button className="intg-btn intg-btn--primary" onClick={() => setShowPicker(true)}>
            Add your first integration
          </button>
        </div>
      ) : (
        <div className="intg-grid">
          {integrations.map(intg => (
            <IntegrationCard key={intg.id} integration={intg} onEdit={handleEdit} />
          ))}
        </div>
      )}

      {showPicker && (
        <TypePicker
          existingTypes={existingTypes}
          onPick={handleAdd}
          onClose={() => setShowPicker(false)}
        />
      )}

      {activeDef && (
        <SlideOver
          def={activeDef}
          integration={activeIntegration !== 'new' ? (activeIntegration as Integration) : null}
          onClose={() => { setActiveIntegration(null); setNewType(null); }}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
