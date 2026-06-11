import { useEffect, useState, useRef } from 'react';
import {
  fetchIntegrations,
  saveIntegration,
  deleteIntegration,
  testIntegration,
  startGmailOAuth,
  startCalendarOAuth,
  fetchAdminConfig,
  updateBraveApiKey,
  updateElevenLabsApiKey,
  updateTelegramConfig,
  getTelegramStatus,
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
      { key: 'defaultRepo', label: 'Default repo', secret: false, placeholder: 'owner/repo' },
    ],
  },
  {
    type: 'slack',
    name: 'Slack',
    icon: 'chat',
    description: 'Incoming and outgoing notifications via Slack.',
    fields: [
      { key: 'webhookUrl', label: 'Incoming Webhook URL', secret: true, placeholder: 'https://hooks.slack.com/...' },
      { key: 'botToken', label: 'Bot Token (optional)', secret: true, placeholder: 'xoxb-...', hint: 'Required for app_mention replies via chat.postMessage' },
      { key: 'signingSecret', label: 'Signing Secret (optional)', secret: true, placeholder: '', hint: 'Required to validate inbound slash commands and app_mention events' },
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
  {
    type: 'gmail',
    name: 'Gmail (IMAP)',
    icon: 'envelope',
    description: 'Inbound task creation from Gmail via OAuth2 IMAP polling.',
    fields: [
      { key: 'email', label: 'Gmail address', secret: false, placeholder: 'you@gmail.com' },
      { key: 'clientId', label: 'Google OAuth Client ID', secret: false, placeholder: '' },
      { key: 'clientSecret', label: 'Google OAuth Client Secret', secret: true, placeholder: '' },
      { key: 'refreshToken', label: 'Refresh Token', secret: true, hint: 'Auto-populated after connecting via Google' },
    ],
  },
  {
    type: 'twilio',
    name: 'Twilio SMS',
    icon: 'phone',
    description: 'Inbound SMS task creation and outbound SMS notifications.',
    fields: [
      { key: 'accountSid', label: 'Account SID', secret: false, placeholder: 'AC...' },
      { key: 'authToken', label: 'Auth Token', secret: true, placeholder: '' },
      { key: 'fromNumber', label: 'From Number', secret: false, placeholder: '+15551234567' },
    ],
  },
  {
    type: 'google-calendar',
    name: 'Google Calendar',
    icon: 'calendar',
    description: 'Read-only calendar sync for conflict detection and availability in Life Manager.',
    fields: [
      { key: 'clientId', label: 'Google OAuth Client ID', secret: false, placeholder: '' },
      { key: 'clientSecret', label: 'Google OAuth Client Secret', secret: true, placeholder: '' },
      { key: 'refreshToken', label: 'Refresh Token', secret: true, hint: 'Auto-populated after connecting via Google' },
    ],
  },
];

const CATALOG_MAP = new Map(CATALOG.map(d => [d.type, d]));

// Types that may be configured multiple times (e.g. work + personal GitHub accounts).
// Each new instance gets a unique id and a user-editable display name.
const MULTI_INSTANCE_TYPES = new Set<IntegrationType>(['github']);

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
  const [oauthing, setOauthing] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(integration?.name ?? def.name);
  const panelRef = useRef<HTMLDivElement>(null);

  // Multi-instance types get a unique id per new instance; existing ids
  // (including the legacy plain "github" id) are never changed.
  const [id] = useState(() =>
    integration?.id ?? (MULTI_INSTANCE_TYPES.has(def.type) ? `${def.type}-${crypto.randomUUID()}` : def.type)
  );

  async function handleGmailOAuth() {
    setOauthing(true);
    setError(null);
    try {
      const { url } = await startGmailOAuth();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOauthing(false);
    }
  }

  async function handleCalendarOAuth() {
    setOauthing(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth();
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOauthing(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const name = MULTI_INSTANCE_TYPES.has(def.type) ? (displayName.trim() || def.name) : def.name;
      const saved = await saveIntegration(id, { type: def.type, name, config: values });
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
              {integration.status === 'connected' && def.type === 'gmail' && (() => {
                const scopes: string[] = Array.isArray(integration.config['scopes'])
                  ? (integration.config['scopes'] as string[])
                  : typeof integration.config['scopes'] === 'string'
                    ? (integration.config['scopes'] as string).split(' ')
                    : [];
                const hasSendScope = scopes.some(s => s.includes('gmail.send') || s.includes('gmail.compose'));
                if (!hasSendScope) {
                  return (
                    <span className="intg-badge intg-badge--error" title="Re-authorize to grant send permissions">
                      Send scope missing
                    </span>
                  );
                }
                return null;
              })()}
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
            {MULTI_INSTANCE_TYPES.has(def.type) && (
              <label className="intg-field">
                <span className="intg-field__label">Display name</span>
                <div className="intg-field__input-wrap">
                  <input
                    type="text"
                    className="intg-field__input"
                    value={displayName}
                    placeholder="e.g. Work, Personal"
                    onChange={e => setDisplayName(e.target.value)}
                  />
                </div>
                <span className="intg-field__hint">Tells multiple {def.name} accounts apart on the integrations grid</span>
              </label>
            )}
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
          {def.type === 'gmail' && (
            <>
              <button
                className="intg-btn intg-btn--ghost"
                onClick={handleGmailOAuth}
                disabled={oauthing}
                title="Authorize via Google and auto-populate the refresh token"
              >
                {oauthing ? 'Opening…' : 'Connect via Google'}
              </button>
              {integration && integration.status === 'connected' && (() => {
                const scopes: string[] = Array.isArray(integration.config['scopes'])
                  ? (integration.config['scopes'] as string[])
                  : typeof integration.config['scopes'] === 'string'
                    ? (integration.config['scopes'] as string).split(' ')
                    : [];
                const hasSendScope = scopes.some(s => s.includes('gmail.send') || s.includes('gmail.compose'));
                if (!hasSendScope) {
                  return (
                    <button
                      className="intg-btn intg-btn--ghost"
                      onClick={handleGmailOAuth}
                      disabled={oauthing}
                      title="Re-authorize with send + compose scopes"
                    >
                      {oauthing ? 'Opening…' : 'Re-authorize'}
                    </button>
                  );
                }
                return null;
              })()}
            </>
          )}
          {def.type === 'google-calendar' && (
            <button
              className="intg-btn intg-btn--ghost"
              onClick={handleCalendarOAuth}
              disabled={oauthing}
              title="Authorize via Google and auto-populate the refresh token"
            >
              {oauthing ? 'Opening…' : 'Connect via Google'}
            </button>
          )}
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
  // Multi-instance types stay available so another account can be added
  const available = CATALOG.filter(d => MULTI_INSTANCE_TYPES.has(d.type) || !existingTypes.has(d.type));
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
                <span className="type-picker__name">
                  {d.name}
                  {existingTypes.has(d.type) && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> — add another</span>}
                </span>
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

  // Brave Search API key state
  const [braveKeySet, setBraveKeySet] = useState(false);
  const [braveInput, setBraveInput] = useState('');
  const [braveSaving, setBraveSaving] = useState(false);
  const [braveSaved, setBraveSaved] = useState(false);
  const [braveError, setBraveError] = useState<string | null>(null);

  // ElevenLabs TTS state
  const [elKeySet, setElKeySet] = useState(false);
  const [elInput, setElInput] = useState('');
  const [elSaving, setElSaving] = useState(false);
  const [elSaved, setElSaved] = useState(false);
  const [elError, setElError] = useState('');

  // Telegram state
  const [telegramStatus, setTelegramStatus] = useState<{ configured: boolean; hasDefaultChatId: boolean; polling: boolean }>({ configured: false, hasDefaultChatId: false, polling: false });
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramSaved, setTelegramSaved] = useState(false);
  const [telegramError, setTelegramError] = useState<string | null>(null);

  useEffect(() => {
    fetchIntegrations()
      .then(setIntegrations)
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
    fetchAdminConfig()
      .then(cfg => {
        setBraveKeySet(cfg.braveApiKey ?? false);
        setElKeySet(cfg.elevenLabsApiKey ?? false);
      })
      .catch(() => { /* non-fatal */ });
    getTelegramStatus()
      .then(setTelegramStatus)
      .catch(() => { /* non-fatal */ });

    // After Gmail OAuth redirect, refresh the integration list
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'gmail') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function handleBraveSave() {
    setBraveSaving(true);
    setBraveError(null);
    try {
      await updateBraveApiKey(braveInput);
      setBraveKeySet(!!braveInput);
      setBraveInput('');
      setBraveSaved(true);
      setTimeout(() => setBraveSaved(false), 3000);
    } catch (err) {
      setBraveError((err as Error).message);
    } finally {
      setBraveSaving(false);
    }
  }

  async function handleTelegramSave() {
    setTelegramSaving(true);
    setTelegramError(null);
    try {
      await updateTelegramConfig({
        ...(telegramToken !== '' ? { botToken: telegramToken } : {}),
        ...(telegramChatId !== '' ? { defaultChatId: telegramChatId } : {}),
      });
      const updated = await getTelegramStatus();
      setTelegramStatus(updated);
      setTelegramToken('');
      setTelegramChatId('');
      setTelegramSaved(true);
      setTimeout(() => setTelegramSaved(false), 3000);
    } catch (err) {
      setTelegramError((err as Error).message);
    } finally {
      setTelegramSaving(false);
    }
  }

  async function handleTelegramClear() {
    setTelegramSaving(true);
    setTelegramError(null);
    try {
      await updateTelegramConfig({ botToken: '', defaultChatId: '' });
      setTelegramStatus({ configured: false, hasDefaultChatId: false, polling: false });
      setTelegramToken('');
      setTelegramChatId('');
    } catch (err) {
      setTelegramError((err as Error).message);
    } finally {
      setTelegramSaving(false);
    }
  }

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
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-subtitle">Connect external services to unlock tools and notifications.</p>
        </div>
        <button className="btn btn-primary" style={{ marginTop: '4px' }} onClick={() => setShowPicker(true)}>
          + Add
        </button>
      </div>

      {integrations.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="empty-state__icon">
            <Icon name="plug" size={40} aria-hidden />
          </div>
          <p className="empty-state__title">No integrations configured</p>
          <p className="empty-state__body">Connect Slack, GitHub, ntfy, and more to unlock tools and notifications.</p>
          <button className="btn btn-primary" onClick={() => setShowPicker(true)}>
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

      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>API Keys</h2>
        <div className={`intg-card intg-card--${braveKeySet ? 'connected' : 'not_configured'}`}>
          <div className="intg-card__top">
            <Icon name="link" size={20} className="intg-card__icon" aria-hidden />
            <div className="intg-card__info">
              <span className="intg-card__name">Brave Search</span>
              <span className="intg-card__summary">Web search via Brave Search API — powers web_search tool</span>
            </div>
            {braveSaved && <span className="intg-card__edit" style={{ color: 'var(--success)', cursor: 'default' }}>Saved ✓</span>}
          </div>
          <div className="intg-card__bottom">
            {statusBadge(braveKeySet ? 'connected' : 'unconfigured')}
          </div>
          <div className="slide-over__fields" style={{ padding: '0.75rem 0 0' }}>
            <label className="intg-field">
              <span className="intg-field__label">API Key</span>
              <div className="intg-field__input-wrap">
                <input
                  type="password"
                  className="intg-field__input"
                  value={braveInput}
                  placeholder={braveKeySet ? '••••••••••••••••' : 'BSA...'}
                  onChange={e => setBraveInput(e.target.value)}
                />
              </div>
            </label>
          </div>
          {braveError && <div className="slide-over__error">{braveError}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
            <button
              className="intg-btn intg-btn--primary"
              onClick={handleBraveSave}
              disabled={braveSaving || (!braveInput && braveKeySet)}
            >
              {braveSaving ? 'Saving…' : (!braveInput && braveKeySet) ? 'Remove' : 'Save'}
            </button>
          </div>
        </div>

        <div className={`intg-card intg-card--${telegramStatus.configured ? 'connected' : 'not_configured'}`} style={{ marginTop: '0.75rem' }}>
          <div className="intg-card__top">
            <Icon name="chat" size={20} className="intg-card__icon" aria-hidden />
            <div className="intg-card__info">
              <span className="intg-card__name">Telegram Bot</span>
              <span className="intg-card__summary">Bidirectional chat via Telegram bot — send and receive messages</span>
            </div>
            {telegramSaved && <span className="intg-card__edit" style={{ color: 'var(--success)', cursor: 'default' }}>Saved ✓</span>}
          </div>
          <div className="intg-card__bottom">
            {statusBadge(telegramStatus.polling ? 'connected' : telegramStatus.configured ? 'connected' : 'unconfigured')}
            {telegramStatus.polling && <span className="intg-badge intg-badge--connected" style={{ marginLeft: '0.5rem' }}>polling</span>}
          </div>
          <div className="slide-over__fields" style={{ padding: '0.75rem 0 0' }}>
            <label className="intg-field">
              <span className="intg-field__label">Bot Token</span>
              <div className="intg-field__input-wrap">
                <input
                  type="password"
                  className="intg-field__input"
                  value={telegramToken}
                  placeholder={telegramStatus.configured ? '••••••••••••••••' : '123456:ABC-...'}
                  onChange={e => setTelegramToken(e.target.value)}
                />
              </div>
            </label>
            <label className="intg-field">
              <span className="intg-field__label">Default Chat ID</span>
              <div className="intg-field__input-wrap">
                <input
                  type="text"
                  className="intg-field__input"
                  value={telegramChatId}
                  placeholder={telegramStatus.hasDefaultChatId ? '(set)' : 'for proactive notifications'}
                  onChange={e => setTelegramChatId(e.target.value)}
                />
              </div>
            </label>
          </div>
          {telegramError && <div className="slide-over__error">{telegramError}</div>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
            {telegramStatus.configured && (
              <button
                className="intg-btn intg-btn--danger"
                onClick={handleTelegramClear}
                disabled={telegramSaving}
              >
                Remove
              </button>
            )}
            <button
              className="intg-btn intg-btn--primary"
              onClick={handleTelegramSave}
              disabled={telegramSaving || (!telegramToken && !telegramChatId)}
            >
              {telegramSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <div className={`intg-card intg-card--${elKeySet ? 'connected' : 'not_configured'}`} style={{ marginTop: '0.75rem' }}>
          <div className="intg-card__header">
            <div className="intg-card__name">ElevenLabs TTS</div>
            {statusBadge(elKeySet ? 'connected' : 'not_configured')}
          </div>
          <div className="intg-card__body">
            <p className="intg-card__desc">High-quality neural text-to-speech. Set your API key to enable cloud synthesis.</p>
            <div className="slide-over__fields">
              <div className="intg-field">
                <label className="intg-field__label">API Key</label>
                <div className="intg-field__input-wrap">
                  <input
                    type="password"
                    className="intg-field__input"
                    placeholder={elKeySet ? '••••••••' : 'sk-...'}
                    value={elInput}
                    onChange={e => { setElInput(e.target.value); setElSaved(false); setElError(''); }}
                  />
                </div>
              </div>
              {elError && <p className="intg-field__error">{elError}</p>}
              <button
                className="btn btn--primary"
                disabled={elSaving || (!elInput && !elKeySet)}
                onClick={async () => {
                  setElSaving(true); setElError('');
                  try {
                    await updateElevenLabsApiKey(elInput);
                    setElKeySet(!!elInput);
                    setElInput(''); setElSaved(true);
                    setTimeout(() => setElSaved(false), 3000);
                  } catch (e) {
                    setElError(e instanceof Error ? e.message : 'Failed to save');
                  } finally {
                    setElSaving(false);
                  }
                }}
              >
                {elSaving ? 'Saving…' : elSaved ? 'Saved ✓' : (!elInput && elKeySet) ? 'Remove' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>

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
