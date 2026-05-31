import { useEffect, useState } from 'react';
import { fetchAdminConfig, updateAdminConfig } from '../api.js';
import type { AdminConfig } from '../types.js';

function Row({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="settings__row">
      <span className="settings__label">{label}</span>
      <span className={`settings__value${mono ? ' settings__value--mono' : ''}`}>{value}</span>
    </div>
  );
}

function OnOff({ on }: { on: boolean }) {
  return (
    <span className={on ? 'settings__badge settings__badge--on' : 'settings__badge settings__badge--off'}>
      {on ? 'on' : 'off'}
    </span>
  );
}

// Editable section for auto-checkpoint and smart routing
function EditableSection({
  config,
  onSave,
}: {
  config: AdminConfig;
  onSave: (updates: Partial<AdminConfig>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [cpTurns, setCpTurns] = useState(String(config.autoCheckpointTurns));
  const [cpMins, setCpMins] = useState(String(config.autoCheckpointMinutes));
  const [compactTurns, setCompactTurns] = useState(String(config.compactAfterTurns));
  const [smartRouting, setSmartRouting] = useState(config.smartRouting);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updates: Partial<AdminConfig> = {
        autoCheckpointTurns: parseInt(cpTurns, 10) || 0,
        autoCheckpointMinutes: parseInt(cpMins, 10) || 0,
        compactAfterTurns: parseInt(compactTurns, 10) || 10,
        smartRouting,
      };
      await onSave(updates);
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <>
        <section className="settings__section">
          <div className="settings__section-header">
            <h2 className="settings__section-title">Auto-checkpoint</h2>
            <div className="settings__section-actions">
              {saved && <span className="settings__saved">Saved ✓</span>}
              <button className="settings__edit-btn" onClick={() => setEditing(true)}>Edit</button>
            </div>
          </div>
          <div className="settings__section-body">
            <Row
              label="Turn-based"
              value={config.autoCheckpointTurns === 0 ? 'disabled' : `every ${config.autoCheckpointTurns} turns`}
            />
            <Row
              label="Time-based"
              value={config.autoCheckpointMinutes === 0 ? 'disabled' : `every ${config.autoCheckpointMinutes} min`}
            />
          </div>
        </section>

        <section className="settings__section">
          <div className="settings__section-header">
            <h2 className="settings__section-title">Agent</h2>
            <button className="settings__edit-btn" onClick={() => setEditing(true)}>Edit</button>
          </div>
          <div className="settings__section-body">
            <Row label="Smart routing" value={<OnOff on={config.smartRouting} />} mono={false} />
            <Row label="Compact after turns" value={config.compactAfterTurns} />
          </div>
        </section>
      </>
    );
  }

  return (
    <section className="settings__section settings__section--editing">
      <div className="settings__section-header">
        <h2 className="settings__section-title">Edit Settings</h2>
      </div>
      <div className="settings__edit-form">
        <label className="settings__edit-field">
          <span>Auto-checkpoint: turns (0 = off)</span>
          <input
            type="number"
            className="settings__input"
            min="0"
            value={cpTurns}
            onChange={e => setCpTurns(e.target.value)}
          />
        </label>
        <label className="settings__edit-field">
          <span>Auto-checkpoint: minutes (0 = off)</span>
          <input
            type="number"
            className="settings__input"
            min="0"
            value={cpMins}
            onChange={e => setCpMins(e.target.value)}
          />
        </label>
        <label className="settings__edit-field">
          <span>Compact after turns</span>
          <input
            type="number"
            className="settings__input"
            min="1"
            value={compactTurns}
            onChange={e => setCompactTurns(e.target.value)}
          />
        </label>
        <label className="settings__edit-field settings__edit-field--toggle">
          <input
            type="checkbox"
            checked={smartRouting}
            onChange={e => setSmartRouting(e.target.checked)}
          />
          <span>Smart routing</span>
        </label>
        {error && <p className="settings__error">{error}</p>}
        <div className="settings__edit-actions">
          <button className="settings__edit-btn" onClick={() => setEditing(false)}>Cancel</button>
          <button className="settings__save-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        <p className="settings__restart-note">
          Some changes take effect on next restart.
        </p>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAdminConfig()
      .then(setConfig)
      .catch(err => setError((err as Error).message));
  }, []);

  async function handleSave(updates: Partial<AdminConfig>) {
    await updateAdminConfig(updates);
    setConfig(prev => prev ? { ...prev, ...updates } : prev);
  }

  if (error)  return <div className="page-error">Failed to load config: {error}</div>;
  if (!config) return <div className="page-loading">Loading…</div>;

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Runtime configuration — persisted to <code>~/.koa/config.json</code></p>
      </header>

      <div className="settings-body">
        <section className="settings__section">
          <h2 className="settings__section-title">Model</h2>
          <div className="settings__section-body">
            <Row label="Model" value={config.model} />
            <Row label="Max tokens" value={config.maxTokens.toLocaleString()} />
            <Row label="Max tool output chars" value={config.maxToolOutputChars.toLocaleString()} />
          </div>
        </section>

        <EditableSection config={config} onSave={handleSave} />

        <section className="settings__section">
          <h2 className="settings__section-title">Memory</h2>
          <div className="settings__section-body">
            <Row label="Engram" value={<OnOff on={config.engramEnabled} />} mono={false} />
            <Row label="SpiderBrain brain" value={config.spiderBrainBrain ?? <span className="settings__muted">not set</span>} />
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">API Key</h2>
          <div className="settings__section-body">
            <Row
              label="Anthropic API key"
              value={
                config.apiKeySet
                  ? <span className="settings__badge settings__badge--on">set</span>
                  : <span className="settings__badge settings__badge--off">not set</span>
              }
              mono={false}
            />
          </div>
        </section>

        <section className="settings__section">
          <h2 className="settings__section-title">Project</h2>
          <div className="settings__section-body">
            <Row label="Project path" value={<span className="settings__path">{config.projectPath}</span>} />
          </div>
        </section>
      </div>
    </div>
  );
}
