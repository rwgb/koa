import { useCallback, useEffect, useRef, useState } from 'react';
import { getDebugLogs, clearDebugLogs, getDebugInfo } from '../api.js';
import type { DebugInfo, DebugLogEntry } from '../types.js';

type LogLevel = 'all' | 'log' | 'warn' | 'error' | 'debug';
type Tab = 'logs' | 'info';

const LEVEL_COLORS: Record<string, string> = {
  log: 'var(--text)',
  warn: '#e6a817',
  error: 'var(--red)',
  debug: 'var(--text-muted)',
};

const tsFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function formatTs(ts: number): string {
  return tsFormatter.format(ts);
}

export default function DebugConsolePage() {
  const [entries, setEntries] = useState<DebugLogEntry[]>([]);
  const [info, setInfo] = useState<DebugInfo | null>(null);
  const [filter, setFilter] = useState<LogLevel>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [tab, setTab] = useState<Tab>('logs');
  const [error, setError] = useState<string | null>(null);

  const logEndRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLogs = useCallback(async () => {
    try {
      const data = await getDebugLogs();
      setEntries(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const data = await getDebugInfo();
      setInfo(data);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadLogs();
    void loadInfo();
  }, [loadLogs, loadInfo]);

  // Auto-refresh logs every 2s
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      void loadLogs();
    }, 2000);
    return () => {
      if (intervalRef.current !== null) clearInterval(intervalRef.current);
    };
  }, [loadLogs]);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && tab === 'logs') {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll, tab]);

  async function handleClear() {
    try {
      await clearDebugLogs();
      setEntries([]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleRefresh() {
    await loadLogs();
    await loadInfo();
  }

  const filtered = filter === 'all' ? entries : entries.filter(e => e.level === filter);

  function countLevel(lvl: string) {
    return entries.filter(e => e.level === lvl).length;
  }

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Page header */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h1 className="page-title">Debug Console</h1>
          <p className="page-subtitle" style={{ color: 'var(--text-muted)', margin: 0 }}>Server logs and diagnostics</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn--secondary" onClick={() => { void handleRefresh(); }}>
            Refresh
          </button>
          <button className="btn btn--danger" onClick={() => { void handleClear(); }}>
            Clear
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner" style={{ marginBottom: '0.75rem', color: 'var(--red)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        <button
          className={`tab-btn${tab === 'logs' ? ' tab-btn--active' : ''}`}
          onClick={() => setTab('logs')}
          style={{ padding: '0.5rem 1rem', background: 'none', border: 'none', cursor: 'pointer', color: tab === 'logs' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: tab === 'logs' ? '2px solid var(--accent)' : '2px solid transparent', fontWeight: tab === 'logs' ? 600 : 400 }}
        >
          Logs ({entries.length})
        </button>
        <button
          className={`tab-btn${tab === 'info' ? ' tab-btn--active' : ''}`}
          onClick={() => setTab('info')}
          style={{ padding: '0.5rem 1rem', background: 'none', border: 'none', cursor: 'pointer', color: tab === 'info' ? 'var(--accent)' : 'var(--text-muted)', borderBottom: tab === 'info' ? '2px solid var(--accent)' : '2px solid transparent', fontWeight: tab === 'info' ? 600 : 400 }}
        >
          Info
        </button>
      </div>

      {tab === 'logs' && (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          {/* Filter row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            {(['all', 'log', 'warn', 'error', 'debug'] as LogLevel[]).map(lvl => (
              <button
                key={lvl}
                onClick={() => setFilter(lvl)}
                style={{
                  padding: '0.25rem 0.625rem',
                  fontSize: '0.8125rem',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  background: filter === lvl ? 'var(--accent)' : 'transparent',
                  color: filter === lvl ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontWeight: filter === lvl ? 600 : 400,
                }}
              >
                {lvl} {lvl === 'all' ? `(${entries.length})` : `(${countLevel(lvl)})`}
              </button>
            ))}
            <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={e => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
          </div>

          {/* Log area */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--surface-2, #111)',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              padding: '0.625rem',
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              lineHeight: 1.6,
            }}
          >
            {filtered.length === 0 ? (
              <span style={{ color: 'var(--text-muted)' }}>No log entries match the current filter.</span>
            ) : (
              filtered.map((entry, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.1rem' }}>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{formatTs(entry.ts)}</span>
                  <span style={{ color: LEVEL_COLORS[entry.level] ?? 'var(--text)', flexShrink: 0, textTransform: 'uppercase', minWidth: '3rem' }}>{entry.level}</span>
                  <span style={{ color: 'var(--text)', wordBreak: 'break-all' }}>{entry.msg}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {tab === 'info' && (
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {info === null ? (
            <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Process table */}
              <section>
                <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Process</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <tbody>
                    {[
                      ['Node.js version', info.nodeVersion],
                      ['Platform / Arch', `${info.platform} / ${info.arch}`],
                      ['PID', String(info.pid)],
                      ['Uptime', `${info.uptime.toFixed(1)}s`],
                      ['CWD', info.cwd],
                    ].map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.375rem 0.5rem 0.375rem 0', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{k}</td>
                        <td style={{ padding: '0.375rem 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              {/* Credentials table */}
              <section>
                <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Credentials</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                  <tbody>
                    {info.credentialKeys.map(({ key, set }) => (
                      <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.375rem 0.5rem 0.375rem 0', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{key}</td>
                        <td style={{ padding: '0.375rem 0' }}>
                          <span style={{
                            display: 'inline-block',
                            padding: '0.125rem 0.5rem',
                            borderRadius: '9999px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            background: set ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: set ? '#22c55e' : 'var(--red)',
                          }}>
                            {set ? 'SET' : 'NOT SET'}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {info.credentialKeys.length === 0 && (
                      <tr><td colSpan={2} style={{ color: 'var(--text-muted)', padding: '0.375rem 0' }}>None</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              {/* Environment table */}
              <section>
                <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Environment</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <tbody>
                    {Object.entries(info.env).map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.25rem 0.5rem 0.25rem 0', fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                        <td style={{ padding: '0.25rem 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{v}</td>
                      </tr>
                    ))}
                    {Object.keys(info.env).length === 0 && (
                      <tr><td colSpan={2} style={{ color: 'var(--text-muted)', padding: '0.25rem 0' }}>Empty</td></tr>
                    )}
                  </tbody>
                </table>
              </section>

              {/* Config table */}
              <section>
                <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Config</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <tbody>
                    {Object.entries(info.config).map(([k, v]) => (
                      <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.25rem 0.5rem 0.25rem 0', fontFamily: 'monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
                        <td style={{ padding: '0.25rem 0', fontFamily: 'monospace', wordBreak: 'break-all' }}>{String(v)}</td>
                      </tr>
                    ))}
                    {Object.keys(info.config).length === 0 && (
                      <tr><td colSpan={2} style={{ color: 'var(--text-muted)', padding: '0.25rem 0' }}>Empty</td></tr>
                    )}
                  </tbody>
                </table>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
