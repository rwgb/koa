import { useEffect, useState } from 'react';
import {
  fetchNotifications,
  fetchIntegrations,
  saveNotificationRules,
  saveQuietHours,
  saveEscalationSettings,
  fetchVapidKey,
  subscribeWebPush,
  unsubscribeWebPush,
  testNotification,
} from '../api.js';
import type { NotificationRule, QuietHours, EscalationSettings, Integration } from '../types.js';

// ── Event catalog ─────────────────────────────────────────────────────────────

const EVENT_OPTIONS = [
  { value: 'task_complete',  label: 'Long task complete'               },
  { value: 'agent_error',    label: 'Agent error'                      },
  { value: 'cost_threshold', label: 'Session cost threshold exceeded'  },
  { value: 'checkpoint',     label: 'Checkpoint saved'                 },
  { value: 'session_start',  label: 'Session started'                  },
];

const NOTIFICATION_CHANNEL_TYPES = new Set(['slack', 'pushover', 'ntfy', 'smtp']);

// ── Channel row ───────────────────────────────────────────────────────────────

function ChannelRow({ integration }: { integration: Integration }) {
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg]     = useState('');

  async function handleTest() {
    setTestState('sending');
    setTestMsg('');
    try {
      const result = await testNotification(integration.id);
      setTestState(result.ok ? 'ok' : 'fail');
      setTestMsg(result.message);
    } catch (err) {
      setTestState('fail');
      setTestMsg((err as Error).message);
    }
  }

  const statusBadge =
    integration.status === 'connected'
      ? <span className="badge badge-green">Connected</span>
      : integration.status === 'error'
        ? <span className="badge" style={{ background: 'rgba(248,81,73,0.15)', color: 'var(--red)' }}>Error</span>
        : <span className="badge badge-muted">Not configured</span>;

  return (
    <div className="setting-row">
      <span className="setting-row__label" style={{ fontWeight: 500, color: 'var(--text)' }}>{integration.name}</span>
      <span className="setting-row__value">{statusBadge}</span>
      <div className="setting-row__actions">
        {integration.status === 'connected' && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void handleTest()}
            disabled={testState === 'sending'}
          >
            {testState === 'sending' ? 'Sending…' : 'Send test'}
          </button>
        )}
        {testState !== 'idle' && testState !== 'sending' && (
          <span style={{ fontSize: '11px', color: testState === 'ok' ? 'var(--green)' : 'var(--red)' }}>
            {testMsg}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  channels,
  onEdit,
  onDelete,
}: {
  rule: NotificationRule;
  channels: Integration[];
  onEdit: (rule: NotificationRule) => void;
  onDelete: (id: string) => void;
}) {
  const event   = EVENT_OPTIONS.find(e => e.value === rule.event)?.label ?? rule.event;
  const channel = channels.find(c => c.id === rule.channel)?.name ?? rule.channel;

  return (
    <div className="notif-rule-row">
      <span className="notif-rule__event">{event}</span>
      <span className="notif-rule__channel">{channel}</span>
      <span className="notif-rule__condition">{rule.condition ?? <span className="notif-muted">Always</span>}</span>
      <div className="notif-rule__actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onEdit(rule)} aria-label="Edit rule">
          Edit
        </button>
        <button
          className="btn btn-danger btn-sm"
          onClick={() => onDelete(rule.id)}
          aria-label="Delete rule"
          style={{ padding: '4px 8px' }}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Add / edit rule form ──────────────────────────────────────────────────────

function RuleForm({
  channels,
  initialRule,
  onSave,
  onCancel,
}: {
  channels: Integration[];
  initialRule?: NotificationRule;
  onSave: (rule: NotificationRule) => void;
  onCancel: () => void;
}) {
  const [event, setEvent]       = useState(initialRule?.event     ?? EVENT_OPTIONS[0].value);
  const [channel, setChannel]   = useState(initialRule?.channel   ?? channels[0]?.id ?? '');
  const [condition, setCondition] = useState(initialRule?.condition ?? '');

  function handleSave() {
    if (!channel) return;
    onSave({
      id:        initialRule?.id ?? `${Date.now()}`,
      event,
      channel,
      condition: condition.trim() || undefined,
    });
  }

  return (
    <div className="notif-add-rule">
      <div className="notif-add-rule__fields">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Event</label>
          <select className="form-select" value={event} onChange={e => setEvent(e.target.value)}>
            {EVENT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Channel</label>
          <select className="form-select" value={channel} onChange={e => setChannel(e.target.value)}>
            {channels.length === 0 && <option value="">No channels configured</option>}
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Condition <span style={{ textTransform: 'none', fontWeight: 400 }}>(optional)</span></label>
          <input
            className="form-input"
            value={condition}
            onChange={e => setCondition(e.target.value)}
            placeholder="e.g. cost > 0.50"
          />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={!channel}>
          {initialRule ? 'Update Rule' : 'Add Rule'}
        </button>
      </div>
    </div>
  );
}

// ── Escalation ladder ─────────────────────────────────────────────────────────

const ESCALATION_LEVELS = [
  { level: 'due-tomorrow', label: 'Due tomorrow (24–48 h)', critical: false },
  { level: '24h',          label: 'Due in < 24 h',          critical: false },
  { level: '8h',           label: 'Due in < 8 h',           critical: true  },
  { level: 'overdue',      label: 'Overdue',                critical: true  },
];

function EscalationSection({
  escalation,
  onChange,
  onSave,
  saving,
  saveError,
  onDismissError,
}: {
  escalation: EscalationSettings;
  onChange: (s: EscalationSettings) => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  onDismissError: () => void;
}) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Deadline Escalation</span>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {saveError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--red)', fontSize: '13px' }}>
          <span>Failed to save escalation settings: {saveError}</span>
          <button className="btn btn-sm" onClick={onDismissError} style={{ padding: '0 6px', lineHeight: '18px', fontSize: '11px' }}>✕</button>
        </div>
      )}
      <div className="notif-escalation">
        <label className="notif-quiet__toggle">
          <input
            type="checkbox"
            checked={escalation.enabled}
            onChange={e => onChange({ enabled: e.target.checked })}
          />
          <span>Enable deadline escalation notifications</span>
        </label>
        <div className="notif-escalation__ladder">
          {ESCALATION_LEVELS.map(({ level, label, critical }) => (
            <div key={level} className="notif-escalation__row">
              <span className="notif-escalation__level">{label}</span>
              <span className={`notif-badge ${critical ? 'notif-badge--critical' : 'notif-badge--info'}`}>
                {critical ? 'bypasses quiet hours' : 'respects quiet hours'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Browser push notifications ─────────────────────────────────────────────────

type PushStatus = 'unknown' | 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed';

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

function BrowserPushSection() {
  const [status, setStatus]   = useState<PushStatus>('unknown');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    navigator.serviceWorker.ready
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setStatus(sub ? 'subscribed' : 'unsubscribed'))
      .catch(() => setStatus('unsubscribed'));
  }, []);

  async function handleSubscribe() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const vapidKey = await fetchVapidKey();
      const reg      = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await subscribeWebPush({ endpoint: json.endpoint, keys: json.keys });
      setStatus('subscribed');
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnsubscribe() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await sub?.unsubscribe();
      await unsubscribeWebPush();
      setStatus('unsubscribed');
    } catch (e) {
      setErrorMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Browser Push Notifications</span>
      </div>
      <div className="notif-push">
        {status === 'unsupported' && (
          <p className="notif-empty">Push notifications are not supported in this browser.</p>
        )}
        {status === 'denied' && (
          <p className="notif-empty">Notifications are blocked by your browser. Allow them in site settings and reload.</p>
        )}
        {(status === 'subscribed' || status === 'unsubscribed' || status === 'unknown') && (
          <>
            <p className="notif-push__desc">
              Receive Koa notifications directly in this browser.{' '}
              {status === 'subscribed' && <span className="badge badge-green">Active</span>}
            </p>
            {status !== 'subscribed' ? (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => void handleSubscribe()}
                disabled={loading || status === 'unknown'}
              >
                {loading ? 'Subscribing…' : 'Enable browser push'}
              </button>
            ) : (
              <button
                className="btn btn-danger btn-sm"
                onClick={() => void handleUnsubscribe()}
                disabled={loading}
              >
                {loading ? 'Unsubscribing…' : 'Disable browser push'}
              </button>
            )}
            {errorMsg && <p style={{ fontSize: '12px', color: 'var(--red)' }}>{errorMsg}</p>}
          </>
        )}
      </div>
    </div>
  );
}

// ── Quiet hours ───────────────────────────────────────────────────────────────

function QuietHoursSection({
  qh,
  onChange,
  onSave,
  saving,
  saveError,
  onDismissError,
}: {
  qh: QuietHours;
  onChange: (qh: QuietHours) => void;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  onDismissError: () => void;
}) {
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Quiet Hours</span>
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {saveError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--red)', fontSize: '13px' }}>
          <span>Failed to save quiet hours: {saveError}</span>
          <button className="btn btn-sm" onClick={onDismissError} style={{ padding: '0 6px', lineHeight: '18px', fontSize: '11px' }}>✕</button>
        </div>
      )}
      <div className="notif-quiet">
        <label className="notif-quiet__toggle">
          <input
            type="checkbox"
            checked={qh.enabled}
            onChange={e => onChange({ ...qh, enabled: e.target.checked })}
          />
          <span>Enable quiet hours</span>
        </label>
        {qh.enabled && (
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">From</label>
              <input
                type="time"
                className="form-input"
                style={{ width: '120px' }}
                value={qh.from}
                onChange={e => onChange({ ...qh, from: e.target.value })}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">To</label>
              <input
                type="time"
                className="form-input"
                style={{ width: '120px' }}
                value={qh.to}
                onChange={e => onChange({ ...qh, to: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [channels, setChannels]   = useState<Integration[]>([]);
  const [rules, setRules]         = useState<NotificationRule[]>([]);
  const [qh, setQh]               = useState<QuietHours>({ enabled: false, from: '22:00', to: '08:00' });
  const [escalation, setEscalation] = useState<EscalationSettings>({ enabled: true });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showAddRule, setShowAddRule] = useState(false);
  const [editingRule, setEditingRule] = useState<NotificationRule | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [savingQh, setSavingQh]       = useState(false);
  const [savingEscalation, setSavingEscalation] = useState(false);
  const [errorRules, setErrorRules]         = useState<string | null>(null);
  const [errorQh, setErrorQh]               = useState<string | null>(null);
  const [errorEscalation, setErrorEscalation] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchNotifications(), fetchIntegrations()])
      .then(([notifs, integrations]) => {
        setRules(notifs.rules);
        setQh(notifs.quietHours);
        setEscalation(notifs.escalation ?? { enabled: true });
        setChannels(integrations.filter(i =>
          NOTIFICATION_CHANNEL_TYPES.has(i.type) && i.status === 'connected',
        ));
      })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDeleteRule(id: string) {
    const updated = rules.filter(r => r.id !== id);
    setSavingRules(true);
    setErrorRules(null);
    try {
      await saveNotificationRules(updated);
      setRules(updated);
    } catch (err) {
      setErrorRules((err as Error).message);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleSaveRule(rule: NotificationRule) {
    const updated = rules.some(r => r.id === rule.id)
      ? rules.map(r => r.id === rule.id ? rule : r)
      : [...rules, rule];
    setSavingRules(true);
    setErrorRules(null);
    try {
      await saveNotificationRules(updated);
      setRules(updated);
      setShowAddRule(false);
      setEditingRule(null);
    } catch (err) {
      setErrorRules((err as Error).message);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleSaveQh() {
    setSavingQh(true);
    setErrorQh(null);
    try {
      await saveQuietHours(qh);
    } catch (err) {
      setErrorQh((err as Error).message);
    } finally {
      setSavingQh(false);
    }
  }

  async function handleSaveEscalation() {
    setSavingEscalation(true);
    setErrorEscalation(null);
    try {
      await saveEscalationSettings(escalation);
    } catch (err) {
      setErrorEscalation((err as Error).message);
    } finally {
      setSavingEscalation(false);
    }
  }

  if (loading) return <div className="page-loading">Loading notifications…</div>;
  if (error)   return <div className="page-error">Failed to load notifications: {error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div className="page-header" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
        <h1 className="page-title">Notifications</h1>
        <p className="page-subtitle">Configure how and when Koa reaches out to you.</p>
      </div>

      <div className="page-body">
        {/* Channels */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Channels</span>
          </div>
          {channels.length === 0 ? (
            <p className="notif-empty">
              No notification channels connected. Configure Slack, Pushover, ntfy, or SMTP in{' '}
              <a href="/integrations" className="notif-link">Integrations</a>.
            </p>
          ) : (
            <div>
              {channels.map(c => <ChannelRow key={c.id} integration={c} />)}
            </div>
          )}
        </div>

        {/* Rules */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Notification Rules</span>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAddRule(v => !v)}
              disabled={channels.length === 0}
              title={channels.length === 0 ? 'Add a notification channel first' : undefined}
            >
              + Add Rule
            </button>
          </div>

          {showAddRule && (
            <RuleForm
              channels={channels}
              onSave={handleSaveRule}
              onCancel={() => setShowAddRule(false)}
            />
          )}

          {rules.length === 0 ? (
            <p className="notif-empty">No notification rules yet.</p>
          ) : (
            <div className="notif-rules">
              <div className="notif-rule-header">
                <span>Event</span>
                <span>Channel</span>
                <span>Condition</span>
                <span />
              </div>
              {rules.map(r => (
                editingRule?.id === r.id ? (
                  <RuleForm
                    key={r.id}
                    channels={channels}
                    initialRule={r}
                    onSave={handleSaveRule}
                    onCancel={() => setEditingRule(null)}
                  />
                ) : (
                  <RuleRow
                    key={r.id}
                    rule={r}
                    channels={channels}
                    onEdit={rule => { setEditingRule(rule); setShowAddRule(false); }}
                    onDelete={id => void handleDeleteRule(id)}
                  />
                )
              ))}
            </div>
          )}
          {savingRules && <p className="notif-saving">Saving…</p>}
          {errorRules && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', color: 'var(--red)', fontSize: '13px' }}>
              <span>Failed to save rules: {errorRules}</span>
              <button className="btn btn-sm" onClick={() => setErrorRules(null)} style={{ padding: '0 6px', lineHeight: '18px', fontSize: '11px' }}>✕</button>
            </div>
          )}
        </div>

        {/* Quiet hours */}
        <QuietHoursSection
          qh={qh}
          onChange={setQh}
          onSave={() => void handleSaveQh()}
          saving={savingQh}
          saveError={errorQh}
          onDismissError={() => setErrorQh(null)}
        />

        {/* Escalation */}
        <EscalationSection
          escalation={escalation}
          onChange={setEscalation}
          onSave={() => void handleSaveEscalation()}
          saving={savingEscalation}
          saveError={errorEscalation}
          onDismissError={() => setErrorEscalation(null)}
        />

        {/* Browser push */}
        <BrowserPushSection />
      </div>
    </div>
  );
}
