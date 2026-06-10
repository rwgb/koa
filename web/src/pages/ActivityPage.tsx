import { useEffect, useState } from 'react';
import { fetchActivitySessions, fetchStatus, fetchWeeklyReport, fetchForecast, fetchProactiveAlerts, fetchConversations, fetchConversationTurns, exportConversation } from '../api.js';
import { Icon } from '../components/Icon.js';
import type { JournalSession, AgentStatus, WeeklyReport, ForecastSummary, ProactiveAlert, Conversation, ConversationTurn } from '../types.js';

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
    <>
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
    {u.agentBreakdown && Object.keys(u.agentBreakdown).length > 0 && (
      <AgentBreakdownTable breakdown={u.agentBreakdown} />
    )}
    </>
  );
}

const AGENT_LABELS: Record<string, string> = {
  'code-assistant': 'Code Assistant',
  'project-manager': 'Project Manager',
  'life-manager': 'Life Manager',
};

function AgentBreakdownTable({ breakdown }: { breakdown: Record<string, { turns: number; estimatedCostUsd: number }> }) {
  return (
    <div className="activity-agent-breakdown">
      <h3 className="mem-subsection__title">Agent breakdown</h3>
      <table className="activity-pricing__table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Turns</th>
            <th>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(breakdown).map(([name, entry]) => (
            <tr key={name}>
              <td className="activity-pricing__model">{AGENT_LABELS[name] ?? name}</td>
              <td>{entry.turns}</td>
              <td>${entry.estimatedCostUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Streak + Weekly Report ────────────────────────────────────────────────────

function StreakPanel({ report }: { report: WeeklyReport }) {
  const velocitySign = report.velocityChange > 0 ? '+' : '';
  return (
    <div className="activity-usage-grid">
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Streak</span>
        <span className="activity-usage-card__value">{report.currentStreak}d</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Done this week</span>
        <span className="activity-usage-card__value">{report.completedThisWeek}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Done last week</span>
        <span className="activity-usage-card__value">{report.completedLastWeek}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Velocity</span>
        <span className="activity-usage-card__value">{velocitySign}{report.velocityChange}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">High-pri open</span>
        <span className="activity-usage-card__value">{report.openHighPriority}</span>
      </div>
      <div className="activity-usage-card">
        <span className="activity-usage-card__label">Due this week</span>
        <span className="activity-usage-card__value">{report.upcomingDeadlines.length}</span>
      </div>
    </div>
  );
}

// ── Proactive Alerts ──────────────────────────────────────────────────────────

function ProactivePanel({ alerts }: { alerts: ProactiveAlert[] }) {
  if (alerts.length === 0) {
    return <div className="mem-empty__text">No active alerts — all clear.</div>;
  }
  return (
    <ul className="activity-alerts-list">
      {alerts.map((a, i) => (
        <li key={i} className={`activity-alert activity-alert--${a.type}`}>
          <span className="activity-alert__icon">
            <Icon name="alert" size={14} />
          </span>
          <span className="activity-alert__message">{a.message}</span>
          <span className="activity-alert__count">{a.taskCount} task{a.taskCount !== 1 ? 's' : ''}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Forecast ──────────────────────────────────────────────────────────────────

function ForecastPanel({ forecast }: { forecast: ForecastSummary }) {
  if (forecast.globalTaskCount === 0) {
    return <div className="mem-empty__text">No forecasting data yet — log <code>actual_hours</code> on completed tasks.</div>;
  }

  const globalPct = forecast.globalRatio !== null
    ? Math.round((forecast.globalRatio - 1) * 100)
    : null;

  return (
    <>
      <div className="activity-usage-grid">
        <div className="activity-usage-card">
          <span className="activity-usage-card__label">Tasks measured</span>
          <span className="activity-usage-card__value">{forecast.globalTaskCount}</span>
        </div>
        <div className="activity-usage-card">
          <span className="activity-usage-card__label">Estimated</span>
          <span className="activity-usage-card__value">{forecast.globalEstimated.toFixed(1)}h</span>
        </div>
        <div className="activity-usage-card">
          <span className="activity-usage-card__label">Actual</span>
          <span className="activity-usage-card__value">{forecast.globalActual.toFixed(1)}h</span>
        </div>
        {globalPct !== null && (
          <div className="activity-usage-card">
            <span className="activity-usage-card__label">Accuracy</span>
            <span className="activity-usage-card__value">
              {globalPct > 0 ? `${globalPct}% over` : globalPct < 0 ? `${Math.abs(globalPct)}% under` : 'On target'}
            </span>
          </div>
        )}
      </div>
      {forecast.projects.length > 1 && (
        <table className="activity-pricing__table">
          <thead>
            <tr><th>Project</th><th>Tasks</th><th>Estimated</th><th>Actual</th><th>Ratio</th></tr>
          </thead>
          <tbody>
            {forecast.projects.map((p) => (
              <tr key={p.projectId}>
                <td className="activity-pricing__model">{p.projectName}</td>
                <td>{p.taskCount}</td>
                <td>{p.estimatedTotal.toFixed(1)}h</td>
                <td>{p.actualTotal.toFixed(1)}h</td>
                <td>{p.ratio.toFixed(2)}×</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
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
              <td><span className="badge badge-blue">{model}</span></td>
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

// ── Conversations ─────────────────────────────────────────────────────────────

function ConversationsTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [turns, setTurns] = useState<Record<string, ConversationTurn[]>>({});

  useEffect(() => {
    setLoading(true);
    fetchConversations()
      .then(setConversations)
      .finally(() => setLoading(false));
  }, []);

  async function expandConversation(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!turns[id]) {
      const t = await fetchConversationTurns(id);
      setTurns((prev) => ({ ...prev, [id]: t }));
    }
  }

  async function handleExport(id: string, format: 'json' | 'markdown') {
    const res = await exportConversation(id, format);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `conversation-${id.slice(0, 8)}.${format === 'markdown' ? 'md' : 'json'}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <div className="mem-empty__text">Loading…</div>;
  if (conversations.length === 0) {
    return <div className="mem-empty"><span className="mem-empty__text">No conversations recorded yet.</span></div>;
  }

  return (
    <ul className="activity-session-list">
      {conversations.map((c) => (
        <li key={c.id} className="activity-session-item">
          <div className="activity-session-item__header" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="activity-session-item__header"
              style={{ flex: 1, textAlign: 'left' }}
              onClick={() => expandConversation(c.id)}
            >
              <span className="activity-session-item__date">
                {c.title ?? 'Untitled'} — {new Date(c.started_at).toLocaleDateString()} ({c.turn_count} turns)
              </span>
              <span className="activity-session-item__toggle">{expanded === c.id ? '▲' : '▼'}</span>
            </button>
            <button onClick={() => handleExport(c.id, 'json')} style={{ fontSize: 11 }}>JSON</button>
            <button onClick={() => handleExport(c.id, 'markdown')} style={{ fontSize: 11 }}>MD</button>
          </div>
          {expanded === c.id && turns[c.id] && (
            <div style={{ padding: '8px 16px' }}>
              {turns[c.id]!.map((t) => (
                <div key={t.id} style={{ marginBottom: 8 }}>
                  <strong>{t.role === 'user' ? 'User' : 'Koa'}</strong>
                  {t.model && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>({t.model})</span>}
                  <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0', fontSize: 12 }}>{t.content.slice(0, 800)}{t.content.length > 800 ? '…' : ''}</pre>
                </div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function ActivityPage() {
  const [sessions, setSessions] = useState<JournalSession[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport | null>(null);
  const [forecast, setForecast] = useState<ForecastSummary | null>(null);
  const [alerts, setAlerts] = useState<ProactiveAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchActivitySessions()
      .then((r) => setSessions(r.sessions))
      .catch((err) => setError((err as Error).message));

    fetchStatus()
      .then(setStatus)
      .catch((err) => setError((err as Error).message));

    fetchWeeklyReport()
      .then(setWeeklyReport)
      .catch(() => { /* analytics unavailable — non-fatal */ });

    fetchForecast()
      .then(setForecast)
      .catch(() => { /* non-fatal */ });

    fetchProactiveAlerts()
      .then((r) => setAlerts(r.alerts))
      .catch(() => { /* non-fatal */ });
  }, []);

  if (error) return <div className="page-error">Error: {error}</div>;

  return (
    <div className="activity-page">
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <h1 className="page-title">Activity</h1>
        <p className="page-subtitle">Productivity analytics, session journal, and cost reference.</p>
      </div>

      <div className="activity-body">
        <section className="mem-section">
          <div className="mem-section__header">
            <h2 className="mem-section__title">Weekly Snapshot</h2>
          </div>
          {weeklyReport
            ? <StreakPanel report={weeklyReport} />
            : <div className="page-loading">Loading…</div>
          }
        </section>

        {alerts !== null && (
          <section className="mem-section">
            <div className="mem-section__header">
              <h2 className="mem-section__title">Proactive Alerts</h2>
              {alerts.length > 0 && <span className="activity-alert-badge">{alerts.length}</span>}
            </div>
            <ProactivePanel alerts={alerts} />
          </section>
        )}

        <section className="mem-section">
          <div className="mem-section__header">
            <h2 className="mem-section__title">Effort Forecasting</h2>
          </div>
          {forecast
            ? <ForecastPanel forecast={forecast} />
            : <div className="page-loading">Loading…</div>
          }
        </section>

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
          <div className="mem-section__header">
            <h2 className="mem-section__title">Conversations</h2>
          </div>
          <ConversationsTab />
        </section>

        <section className="mem-section">
          <PricingTable />
        </section>
      </div>
    </div>
  );
}
