import { useEffect, useState } from 'react';
import { fetchAdminConfig, updateAdminConfig, getOllamaModels, getSandboxStatus, getBrowserStatus, installBrowser, checkForUpdate, runUpdate } from '../api.js';
import type { AdminConfig } from '../types.js';

// ── Inline editable string/number row ──────────────────────────────────────────

function EditableRow({
  label,
  value,
  type = 'text',
  options,
  onSave,
}: {
  label: string;
  value: string | number;
  type?: 'text' | 'number' | 'password' | 'select';
  options?: { value: string; label: string }[];
  onSave: (v: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(String(value));
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setErr(null);
    try {
      await onSave(draft);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && type !== 'text') void handleSave();
    if (e.key === 'Escape') { setEditing(false); setDraft(String(value)); }
  }

  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      {editing ? (
        <>
          <div className="setting-row__value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {type === 'select' && options ? (
              <select
                className="form-select"
                style={{ width: 'auto', minWidth: '180px' }}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                autoFocus
              >
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                type={type === 'password' ? 'password' : type === 'number' ? 'number' : 'text'}
                className="form-input"
                style={{ width: 'auto', minWidth: '180px' }}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                autoFocus
              />
            )}
            {err && <span style={{ fontSize: '11px', color: 'var(--red)' }}>{err}</span>}
          </div>
          <div className="setting-row__actions">
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(String(value)); }}>
              Cancel
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="setting-row__value" style={{ fontFamily: 'inherit', color: 'var(--text)' }}>
            {saved
              ? <span style={{ color: 'var(--green)', fontSize: '12px' }}>Saved</span>
              : (type === 'password' ? '••••••••' : String(value))
            }
          </span>
          <div className="setting-row__actions">
            <button className="btn btn-secondary btn-sm" onClick={() => { setDraft(String(value)); setEditing(true); }}>
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Boolean toggle row ─────────────────────────────────────────────────────────

function BoolRow({
  label,
  value,
  onSave,
}: {
  label: string;
  value: boolean;
  onSave: (v: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    try { await onSave(!value); }
    finally { setSaving(false); }
  }

  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <span className="setting-row__value">
        {value
          ? <span className="badge badge-green">on</span>
          : <span className="badge badge-muted">off</span>
        }
      </span>
      <div className="setting-row__actions">
        <button className="btn btn-secondary btn-sm" onClick={() => void toggle()} disabled={saving}>
          {saving ? '…' : 'Toggle'}
        </button>
      </div>
    </div>
  );
}

// ── Read-only display row ──────────────────────────────────────────────────────

function DisplayRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      <span className="setting-row__value">{children}</span>
    </div>
  );
}

// ── Auto-checkpoint + Agent editable group ─────────────────────────────────────

function CheckpointSection({
  config,
  onSave,
}: {
  config: AdminConfig;
  onSave: (updates: Partial<AdminConfig>) => Promise<void>;
}) {
  const [editing, setEditing]         = useState(false);
  const [cpTurns, setCpTurns]         = useState(String(config.autoCheckpointTurns));
  const [cpMins, setCpMins]           = useState(String(config.autoCheckpointMinutes));
  const [compactTurns, setCompactTurns] = useState(String(config.compactAfterTurns));
  const [smartRouting, setSmartRouting] = useState(config.smartRouting);
  const [autoChaining, setAutoChaining] = useState(config.autoChaining ?? false);
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        autoCheckpointTurns:  parseInt(cpTurns, 10) || 0,
        autoCheckpointMinutes: parseInt(cpMins, 10) || 0,
        compactAfterTurns:    parseInt(compactTurns, 10) || 10,
        smartRouting,
        autoChaining,
      });
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="section">
        <div className="section-header">
          <span className="section-title">Auto-checkpoint &amp; Agent</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div className="form-group">
            <label className="form-label">Checkpoint turns (0 = off)</label>
            <input type="number" min="0" className="form-input" value={cpTurns} onChange={e => setCpTurns(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Checkpoint minutes (0 = off)</label>
            <input type="number" min="0" className="form-input" value={cpMins} onChange={e => setCpMins(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Compact after turns</label>
            <input type="number" min="1" className="form-input" value={compactTurns} onChange={e => setCompactTurns(e.target.value)} />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 0 }}>
            <label className="form-label" style={{ margin: 0 }}>Smart routing</label>
            <input type="checkbox" checked={smartRouting} onChange={e => setSmartRouting(e.target.checked)} />
          </div>
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: 0 }}>
            <label className="form-label" style={{ margin: 0 }}>Auto chaining</label>
            <input type="checkbox" checked={autoChaining} onChange={e => setAutoChaining(e.target.checked)} />
          </div>
        </div>
        {error && <p style={{ color: 'var(--red)', fontSize: '12px', marginTop: '8px' }}>{error}</p>}
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px' }}>Some changes take effect on next restart.</p>
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Auto-checkpoint &amp; Agent</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {saved && <span style={{ fontSize: '11px', color: 'var(--green)' }}>Saved</span>}
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>
      <div>
        <DisplayRow label="Checkpoint turns">
          {config.autoCheckpointTurns === 0 ? 'disabled' : `every ${config.autoCheckpointTurns} turns`}
        </DisplayRow>
        <DisplayRow label="Checkpoint minutes">
          {config.autoCheckpointMinutes === 0 ? 'disabled' : `every ${config.autoCheckpointMinutes} min`}
        </DisplayRow>
        <DisplayRow label="Compact after turns">{config.compactAfterTurns}</DisplayRow>
        <DisplayRow label="Smart routing">
          {config.smartRouting
            ? <span className="badge badge-green">on</span>
            : <span className="badge badge-muted">off</span>
          }
        </DisplayRow>
        <DisplayRow label="Auto chaining">
          {config.autoChaining
            ? <span className="badge badge-green">on</span>
            : <span className="badge badge-muted">off</span>
          }
        </DisplayRow>
      </div>
    </div>
  );
}

// ── API key row (set-only — key is never returned from server) ─────────────────

function ApiKeyRow({ label = 'Anthropic API key', isSet, onSave }: { label?: string; isSet: boolean; onSave: (v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  async function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await onSave(draft.trim());
      setEditing(false);
      setDraft('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="setting-row">
      <span className="setting-row__label">{label}</span>
      {editing ? (
        <>
          <div className="setting-row__value" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="password"
              className="form-input"
              style={{ width: 'auto', minWidth: '260px' }}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleSave(); if (e.key === 'Escape') { setEditing(false); setDraft(''); } }}
              placeholder="sk-ant-…"
              autoFocus
            />
            {err && <span style={{ fontSize: '11px', color: 'var(--red)' }}>{err}</span>}
          </div>
          <div className="setting-row__actions">
            <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setDraft(''); }}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="setting-row__value">
            {saved
              ? <span style={{ color: 'var(--green)', fontSize: '12px' }}>Saved</span>
              : isSet
                ? <span className="badge badge-green">SET</span>
                : <span className="badge badge-muted">NOT SET</span>
            }
          </span>
          <div className="setting-row__actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              {isSet ? 'Change' : 'Set'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Provider section ───────────────────────────────────────────────────────────

function ProviderSection({
  config,
  onSave,
}: {
  config: AdminConfig;
  onSave: (updates: Partial<AdminConfig>) => Promise<void>;
}) {
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  async function testConnection() {
    setTestStatus('testing');
    setTestMessage('');
    try {
      const models = await getOllamaModels();
      setTestStatus('ok');
      setTestMessage(models.length > 0 ? `Models: ${models.join(', ')}` : 'Connected (no models listed)');
    } catch (e: unknown) {
      setTestStatus('error');
      setTestMessage((e as Error).message);
    }
  }

  const provider = config.provider ?? 'anthropic';

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">LLM Provider</span>
      </div>
      <EditableRow
        label="Provider"
        value={provider}
        type="select"
        options={[
          { value: 'anthropic', label: 'Anthropic (cloud)' },
          { value: 'ollama', label: 'Ollama (local)' },
          { value: 'openai-compatible', label: 'OpenAI-compatible' },
          { value: 'google', label: 'Google Gemini' },
        ]}
        onSave={v => onSave({ provider: v as AdminConfig['provider'] })}
      />
      {provider === 'ollama' && (
        <>
          <EditableRow
            label="Ollama model"
            value={config.ollamaModel ?? 'llama3.2'}
            onSave={v => onSave({ ollamaModel: v })}
          />
          <EditableRow
            label="Ollama base URL"
            value={config.ollamaBaseUrl ?? 'http://localhost:11434'}
            onSave={v => onSave({ ollamaBaseUrl: v })}
          />
          <div className="setting-row">
            <span className="setting-row__label">Connection</span>
            <span className="setting-row__value">
              {testStatus === 'ok' && (
                <span style={{ color: 'var(--green)', fontSize: '12px' }}>{testMessage}</span>
              )}
              {testStatus === 'error' && (
                <span style={{ color: 'var(--red)', fontSize: '12px' }}>{testMessage}</span>
              )}
              {testStatus === 'idle' && (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Not tested</span>
              )}
              {testStatus === 'testing' && (
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>Testing…</span>
              )}
            </span>
            <div className="setting-row__actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void testConnection()}
                disabled={testStatus === 'testing'}
              >
                Test connection
              </button>
            </div>
          </div>
        </>
      )}
      {provider === 'openai-compatible' && (
        <>
          <EditableRow
            label="Base URL"
            value={config.openaiCompatibleBaseUrl ?? ''}
            onSave={v => onSave({ openaiCompatibleBaseUrl: v })}
          />
          <ApiKeyRow
            label="API key"
            isSet={config.openaiCompatibleApiKeySet ?? false}
            onSave={v => onSave({ openaiCompatibleApiKey: v })}
          />
          <EditableRow
            label="Model"
            value={config.openaiCompatibleModel ?? 'gpt-4o-mini'}
            onSave={v => onSave({ openaiCompatibleModel: v })}
          />
        </>
      )}
      {provider === 'google' && (
        <>
          <ApiKeyRow
            label="Google API key"
            isSet={config.googleApiKeySet ?? false}
            onSave={v => onSave({ googleApiKey: v })}
          />
          <EditableRow
            label="Model"
            value={config.googleModel ?? 'gemini-2.0-flash'}
            onSave={v => onSave({ googleModel: v })}
          />
        </>
      )}
    </div>
  );
}

// ── Software update section ────────────────────────────────────────────────────

function UpdateSection() {
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheck() {
    setChecking(true); setResult(null); setError(null);
    try { setResult(await checkForUpdate()); }
    catch (e) { setError((e as Error).message); }
    finally { setChecking(false); }
  }

  async function handleUpdate() {
    setUpdating(true); setResult(null); setError(null);
    try { setResult(await runUpdate()); }
    catch (e) { setError((e as Error).message); }
    finally { setUpdating(false); }
  }

  const busy = checking || updating;
  const statusColor = result
    ? result.status === 'updated' ? 'var(--green)'
      : result.status === 'up-to-date' ? 'var(--text-muted)'
      : result.status === 'rolled-back' || result.status === 'error' ? 'var(--red)'
      : 'var(--blue)'
    : undefined;

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Software Update</span>
      </div>
      <div className="setting-row">
        <span className="setting-row__label">Update</span>
        <div className="setting-row__actions" style={{ gap: '8px', display: 'flex', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={handleCheck} disabled={busy}>
            {checking ? 'Checking…' : 'Check'}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleUpdate} disabled={busy}>
            {updating ? 'Updating…' : 'Update now'}
          </button>
        </div>
      </div>
      {(result || error) && (
        <div className="setting-row">
          <span className="setting-row__label" />
          <span style={{ fontSize: '12px', color: error ? 'var(--red)' : statusColor }}>
            {error ?? result?.message}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Code Execution section ─────────────────────────────────────────────────────

function CodeExecutionSection({
  config,
  onSave,
}: {
  config: AdminConfig;
  onSave: (updates: Partial<AdminConfig>) => Promise<void>;
}) {
  const [sandboxAvailable, setSandboxAvailable] = useState<boolean | null>(null);
  const backend = config.sandboxBackend ?? 'local';
  const timeoutSec = Math.round((config.sandboxTimeoutMs ?? 10000) / 1000);

  useEffect(() => {
    getSandboxStatus()
      .then(s => setSandboxAvailable(s.available))
      .catch(() => setSandboxAvailable(false));
  }, [backend]);

  function handleBackendChange(value: string) {
    void onSave({ sandboxBackend: value as 'local' | 'docker' });
  }

  function handleTimeoutChange(e: React.ChangeEvent<HTMLInputElement>) {
    const sec = parseInt(e.target.value, 10);
    if (sec >= 5 && sec <= 60) {
      void onSave({ sandboxTimeoutMs: sec * 1000 });
    }
  }

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Code Execution</span>
      </div>

      {/* Backend radio */}
      <div className="setting-row">
        <span className="setting-row__label">Backend</span>
        <span className="setting-row__value" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="sandboxBackend"
              value="local"
              checked={backend === 'local'}
              onChange={() => handleBackendChange('local')}
            />
            Local
          </label>
          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              name="sandboxBackend"
              value="docker"
              checked={backend === 'docker'}
              onChange={() => handleBackendChange('docker')}
            />
            Docker
          </label>
        </span>
      </div>

      {/* Timeout slider */}
      <div className="setting-row">
        <span className="setting-row__label">Timeout</span>
        <span className="setting-row__value" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <input
            type="range"
            min="5"
            max="60"
            step="5"
            value={timeoutSec}
            onChange={handleTimeoutChange}
            style={{ width: '140px' }}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', minWidth: '36px' }}>
            {timeoutSec}s
          </span>
        </span>
      </div>

      {/* Docker availability dot */}
      <div className="setting-row">
        <span className="setting-row__label">
          {backend === 'docker' ? 'Docker' : 'Runner'} status
        </span>
        <span className="setting-row__value">
          {sandboxAvailable === null && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Checking…</span>
          )}
          {sandboxAvailable === true && (
            <span className="badge badge-green">available</span>
          )}
          {sandboxAvailable === false && (
            <span className="badge badge-muted">unavailable</span>
          )}
        </span>
      </div>
    </div>
  );
}

// ── Browser Automation section ─────────────────────────────────────────────────

function BrowserSection({
  config,
  onSave,
}: {
  config: AdminConfig;
  onSave: (updates: Partial<AdminConfig>) => Promise<void>;
}) {
  const [browserStatus, setBrowserStatus] = useState<{
    available: boolean;
    playwrightInstalled: boolean;
  } | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    getBrowserStatus()
      .then(setBrowserStatus)
      .catch(() => setBrowserStatus({ available: false, playwrightInstalled: false }));
  }, []);

  async function handleInstall() {
    setInstalling(true);
    setInstallError(null);
    try {
      await installBrowser();
      const status = await getBrowserStatus();
      setBrowserStatus(status);
    } catch (e: unknown) {
      setInstallError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Browser Automation</span>
      </div>

      <BoolRow
        label="Enable browser tools"
        value={config.browserEnabled ?? false}
        onSave={v => onSave({ browserEnabled: v })}
      />

      <div className="setting-row">
        <span className="setting-row__label">Playwright status</span>
        <span className="setting-row__value">
          {browserStatus === null && (
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Checking…</span>
          )}
          {browserStatus?.playwrightInstalled && (
            <span className="badge badge-green">Playwright installed</span>
          )}
          {browserStatus !== null && !browserStatus.playwrightInstalled && (
            <span className="badge badge-muted">Not installed</span>
          )}
        </span>
        <div className="setting-row__actions">
          {browserStatus !== null && !browserStatus.playwrightInstalled && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => void handleInstall()}
              disabled={installing}
            >
              {installing ? 'Installing…' : 'Install Playwright'}
            </button>
          )}
        </div>
      </div>

      {installError && (
        <p style={{ fontSize: '12px', color: 'var(--red)', marginTop: '4px' }}>{installError}</p>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

const MODEL_OPTIONS = [
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fast)' },
  { value: 'claude-sonnet-4-6',         label: 'Sonnet 4.6 (standard)' },
  { value: 'claude-opus-4-7',           label: 'Opus 4.7 (powerful)' },
];

export default function SettingsPage() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    fetchAdminConfig()
      .then(setConfig)
      .catch(err => setError((err as Error).message));
  }, []);

  async function handleSave(updates: Partial<AdminConfig>) {
    await updateAdminConfig(updates);
    setConfig(prev => prev ? { ...prev, ...updates } : prev);
  }

  if (error)   return <div className="page-error">Failed to load config: {error}</div>;
  if (!config) return <div className="page-loading">Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Runtime configuration — persisted to <code style={{ color: 'var(--cyan)', fontFamily: 'inherit' }}>~/.koa/config.json</code></p>
      </div>

      <div className="page-body">
        {/* Model */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Model</span>
          </div>
          <EditableRow
            label="Model"
            value={config.model}
            type="select"
            options={MODEL_OPTIONS}
            onSave={v => handleSave({ model: v })}
          />
          <EditableRow
            label="Max tokens"
            value={config.maxTokens}
            type="number"
            onSave={v => handleSave({ maxTokens: parseInt(v, 10) })}
          />
          <EditableRow
            label="Max tool output chars"
            value={config.maxToolOutputChars}
            type="number"
            onSave={v => handleSave({ maxToolOutputChars: parseInt(v, 10) })}
          />
        </div>

        {/* LLM Provider */}
        <ProviderSection config={config} onSave={handleSave} />

        {/* Code Execution */}
        <CodeExecutionSection config={config} onSave={handleSave} />

        {/* Browser Automation */}
        <BrowserSection config={config} onSave={handleSave} />

        {/* Auto-checkpoint + Agent */}
        <CheckpointSection config={config} onSave={handleSave} />

        {/* Memory */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Memory</span>
          </div>
          <BoolRow
            label="Engram"
            value={config.engramEnabled}
            onSave={v => handleSave({ engramEnabled: v })}
          />
          <div className="setting-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
            <span className="setting-row__label" style={{ marginBottom: '2px' }}>
              SpiderBrain status:&nbsp;
              {config.spiderBrainAvailable
                ? <span className="badge badge-green">active</span>
                : <span className="badge badge-muted">not found</span>
              }
            </span>
          </div>
          <EditableRow
            label="SpiderBrain brain path"
            value={config.spiderBrainBrain ?? ''}
            onSave={v => handleSave({ spiderBrainBrain: v.trim() || null })}
          />
        </div>

        {/* API Key */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">API Key</span>
          </div>
          <ApiKeyRow isSet={config.apiKeySet} onSave={v => handleSave({ apiKey: v })} />
        </div>

        {/* Voice / TTS */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Voice / TTS</span>
          </div>
          <EditableRow
            label="TTS provider"
            value={config.ttsProvider ?? 'say'}
            type="select"
            options={[
              { value: 'say', label: 'macOS say (built-in)' },
              { value: 'elevenlabs', label: 'ElevenLabs' },
            ]}
            onSave={v => handleSave({ ttsProvider: v as 'say' | 'elevenlabs' })}
          />
          {config.ttsProvider === 'elevenlabs' && (
            <>
              <EditableRow
                label="ElevenLabs voice ID"
                value={config.elevenLabsVoiceId ?? '21m00Tcm4TlvDq8ikWAM'}
                onSave={v => handleSave({ elevenLabsVoiceId: v })}
              />
              <EditableRow
                label="ElevenLabs model"
                value={config.elevenLabsModel ?? 'eleven_turbo_v2_5'}
                onSave={v => handleSave({ elevenLabsModel: v })}
              />
            </>
          )}
        </div>

        {/* Software Update */}
        <UpdateSection />

        {/* Project */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Project</span>
          </div>
          <EditableRow
            label="Default project path"
            value={config.defaultProjectPath ?? ''}
            onSave={v => handleSave({ defaultProjectPath: v || null })}
          />
          <DisplayRow label="Active path">
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>
              {config.projectPath}
            </span>
          </DisplayRow>
        </div>
      </div>
    </div>
  );
}
