import { useEffect, useState } from 'react';
import { fetchAdminConfig } from '../api.js';
import type { AdminConfig } from '../types.js';

function Row({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="settings__row">
      <span className="settings__label">{label}</span>
      <span className={`settings__value${mono ? ' settings__value--mono' : ''}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <h2 className="settings__section-title">{title}</h2>
      <div className="settings__section-body">{children}</div>
    </section>
  );
}

function OnOff({ on }: { on: boolean }) {
  return (
    <span className={on ? 'settings__badge settings__badge--on' : 'settings__badge settings__badge--off'}>
      {on ? 'on' : 'off'}
    </span>
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

  if (error) {
    return <div className="page-error">Failed to load config: {error}</div>;
  }

  if (!config) {
    return <div className="page-loading">Loading…</div>;
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Runtime configuration — edit via env vars or <code>~/.koa/config.json</code></p>
      </header>

      <div className="settings-body">
        <Section title="Agent">
          <Row label="Default model" value={config.model} />
          <Row label="Max tokens" value={config.maxTokens.toLocaleString()} />
          <Row label="Smart routing" value={<OnOff on={config.smartRouting} />} mono={false} />
          <Row label="Compact after turns" value={config.compactAfterTurns} />
          <Row label="Max tool output chars" value={config.maxToolOutputChars.toLocaleString()} />
        </Section>

        <Section title="Auto-checkpoint">
          <Row
            label="Turn-based"
            value={config.autoCheckpointTurns === 0 ? 'disabled' : `every ${config.autoCheckpointTurns} turns`}
          />
          <Row
            label="Time-based"
            value={config.autoCheckpointMinutes === 0 ? 'disabled' : `every ${config.autoCheckpointMinutes} min`}
          />
        </Section>

        <Section title="Memory">
          <Row label="Engram" value={<OnOff on={config.engramEnabled} />} mono={false} />
          <Row label="SpiderBrain brain" value={config.spiderBrainBrain ?? <span className="settings__muted">not set</span>} />
        </Section>

        <Section title="API Key">
          <Row
            label="Anthropic API key"
            value={
              config.apiKeySet
                ? <span className="settings__badge settings__badge--on">set</span>
                : <span className="settings__badge settings__badge--off">not set</span>
            }
            mono={false}
          />
        </Section>

        <Section title="Project">
          <Row label="Project path" value={<span className="settings__path">{config.projectPath}</span>} />
        </Section>
      </div>
    </div>
  );
}
