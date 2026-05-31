import { useEffect, useState } from 'react';
import { fetchActivitySessions, fetchStatus } from '../api.js';
import type { JournalSession, AgentStatus } from '../types.js';

const ANTHROPIC_PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 0.8, output: 4, cacheWrite: 1, cacheRead: 0.08 },
  'claude-opus-4-7': { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
};

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric'
  });
}

// ── Session Log ──────────────────────────────────────────────────────────────

function SessionLog({ sessions }: { sessions: JournalSession[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="mem-empty">
        <span className="mem-empty__text">No journal entries yet. Sessions write here on finalize.</span>
      </div>
    );
  }

  return (
    <ul className="activity-session-list">
      {sessions.map((s) => (
        <li key={s.date} className="activity-session-item">
          <button
            className="activity-session-item__header"
            onClick={() => setExpanded(expanded === s.date ? null : s.date)}
          >
            <span className="activity-session-item__date">{formatDate(s.date)}</span>
            <span className="activity-session-item__toggle">{expanded === s.date ? '▲' : '▼'}</span>
          </button>
          {expanded === s.date && (
            <pre className="activity-session-item__content">{s.content}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Current Session Usage ────────────────────────────────────────────────────

function UsagePanel({ status }: { status: AgentStatus }) {
  const u = status.usage;
  if (!u) return <div className="mem-empty__text">No usage data yet — start a chat session first.</div>;

  const costUsd = u.estimatedCostUsd;

  return (
    <div className="activity-usage-grid">
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Turns</span>
        <span className="activity-usage-card__value">{u.turnsCount}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Input tokens</span>
        <span className="activity-usage-card__value">{u.inputTokens.toLocaleString()}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Output tokens</span>
        <span className="activity-usage-card__value">{u.outputTokens.toLocaleString()}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Cache read</span>
        <span className="activity-usage-card__value">{u.cacheReadTokens.toLocaleString()}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Cache write</span>
        <span className="activity-usage-card__value">{u.cacheWriteTokens.toLocaleString()}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Cache hit rate</span>
        <span className="activity-usage-card__value">{(u.cacheHitRate * 100).toFixed(1)}%</span>
      </div>
      <div className="activity-usage-card activity-usage-card--cost">
        <span className="activity-usage-card__label">Est. cost</span>
        <span className="activity-usage-card__value">${costUsd.toFixed(4)}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Model</span>
        <span className="activity-usage-card__value activity-usage-card__value--mono">
          {status.activeModel ?? status.model}
        </span>
      </div>
    </div>
  );
}

// ── Pricing reference ────────────────────────────────────────────────────────

function PricingTable() {
  return (
    <div className="activity-pricing">
      <h3 className="mem-subsection__title">Model pricing (per 1M tokens, USD)</h3>
      <table className="activity-pricing__table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache write</th>
            <th>Cache read</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(ANTHROPIC_PRICING).map(([model, p]) => (
            <tr key={model}>
              <td className="activity-pricing__model">{model}</td>
              <td>${p.input}</td>
              <td>${p.output}</td>
              <td>${p.cacheWrite}</td>
              <td>${p.cacheRead}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="activity-pricing__note">Prices are estimates. Check Anthropic's pricing page for current rates.</p>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [sessions, setSessions] = useState<JournalSession[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActivitySessions()
      .then((r) => setSessions(r.sessions))
      .catch((err) => setError((err as Error).message));

    fetchStatus()
      .then(setStatus)
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="activity-page">
      <header className="page-header">
        <h1 className="page-title">Activity</h1>
        <p className="page-subtitle">Session journal, current usage, and cost reference.</p>
      </header>

      <div className="activity-body">
        <section className="mem-section">
          <div className="mem-section__header">
            <h2 className="mem-section__title">Current Session</h2>
          </div>
          {status ? <UsagePanel status={status} /> : <div className="page-loading">Loading…</div>}
        </section>

        <section className="mem-section">
          <div className="mem-section__header">
            <h2 className="mem-section__title">Session Journal</h2>
            <span className="mem-field__value--muted">{sessions.length} entries</span>
          </div>
          <SessionLog sessions={sessions} />
        </section>

        <section className="mem-section">
          <PricingTable />
        </section>
      </div>
    </div>
  );
}
