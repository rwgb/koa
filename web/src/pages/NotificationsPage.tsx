import { useEffect, useState } from 'react';
import {
  fetchNotifications,
  fetchIntegrations,
  saveNotificationRules,
  saveQuietHours,
  testNotification,
} from '../api.js';
import type { NotificationRule, QuietHours, Integration } from '../types.js';

// ── Event catalog ─────────────────────────────────────────────────────────────

const EVENT_OPTIONS = [
  { value: 'task_complete', label: 'Long task complete' },
  { value: 'agent_error', label: 'Agent error' },
  { value: 'cost_threshold', label: 'Session cost threshold exceeded' },
  { value: 'checkpoint', label: 'Checkpoint saved' },
  { value: 'session_start', label: 'Session started' },
];

const NOTIFICATION_CHANNEL_TYPES = new Set(['slack', 'pushover', 'ntfy', 'smtp']);

// ── Channel row ───────────────────────────────────────────────────────────────

function ChannelRow({
  integration,
}: {
  integration: Integration;
}) {
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');

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

  const statusCls =
    integration.status === 'connected' ? 'notif-badge notif-badge--connected' :
    integration.status === 'error'     ? 'notif-badge notif-badge--error' :
                                         'notif-badge notif-badge--unconfigured';

  return (
    <div className="notif-channel-row">
      <span className="notif-channel__name">{integration.name}</span>
      <span className={statusCls}>
        {integration.status === 'connected' ? 'Connected' : integration.status === 'error' ? 'Error' : 'Not configured'}
      </span>
      {integration.status === 'connected' && (
        <button
          className="notif-btn notif-btn--ghost"
          onClick={handleTest}
          disabled={testState === 'sending'}
        >
          {testState === 'sending' ? 'Sending…' : 'Send test'}
        </button>
      )}
      {testState !== 'idle' && testState !== 'sending' && (
        <span className={`notif-test-result notif-test-result--${testState}`}>
          {testState === 'ok' ? '✓' : '✗'} {testMsg}
        </span>
      )}
    </div>
  );
}

// ── Rule row ──────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  channels,
  onDelete,
}: {
  rule: NotificationRule;
  channels: Integration[];
  onDelete: (id: string) => void;
}) {
  const event = EVENT_OPTIONS.find(e => e.value === rule.event)?.label ?? rule.event;
  const channel = channels.find(c => c.id === rule.channel)?.name ?? rule.channel;

  return (
    <div className="notif-rule-row">
      <span className="notif-rule__event">{event}</span>
      <span className="notif-rule__channel">{channel}</span>
      <span className="notif-rule__condition">{rule.condition ?? <span className="notif-muted">Always</span>}</span>
      <button
        className="notif-btn notif-btn--danger-ghost"
        onClick={() => onDelete(rule.id)}
        aria-label="Delete rule"
      >
        ✕
      </button>
    </div>
  );
}

// ── Add rule form ─────────────────────────────────────────────────────────────

function AddRuleForm({
  channels,
  onAdd,
  onCancel,
}: {
  channels: Integration[];
  onAdd: (rule: NotificationRule) => void;
  onCancel: () => void;
}) {
  const [event, setEvent] = useState(EVENT_OPTIONS[0].value);
  const [channel, setChannel] = useState(channels[0]?.id ?? '');
  const [condition, setCondition] = useState('');

  function handleAdd() {
    if (!channel) return;
    onAdd({
      id: `${Date.now()}`,
      event,
      channel,
      condition: condition.trim() || undefined,
    });
  }

  return (
    <div className="notif-add-rule">
      <div className="notif-add-rule__fields">
        <label className="notif-add-rule__field">
          <span>Event</span>
          <select value={event} onChange={e => setEvent(e.target.value)} className="notif-select">
            {EVENT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="notif-add-rule__field">
          <span>Channel</span>
          <select value={channel} onChange={e => setChannel(e.target.value)} className="notif-select">
            {channels.length === 0 && <option value="">No channels configured</option>}
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="notif-add-rule__field">
          <span>Condition <span className="notif-muted">(optional)</span></span>
          <input
            className="notif-input"
            value={condition}
            onChange={e => setCondition(e.target.value)}
            placeholder="e.g. cost > 0.50"
          />
        </label>
      </div>
      <div className="notif-add-rule__actions">
        <button className="notif-btn notif-btn--ghost" onClick={onCancel}>Cancel</button>
        <button className="notif-btn notif-btn--primary" onClick={handleAdd} disabled={!channel}>
          Add Rule
        </button>
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
}: {
  qh: QuietHours;
  onChange: (qh: QuietHours) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <section className="notif-section">
      <h2 className="notif-section__title">Quiet Hours</h2>
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
          <div className="notif-quiet__times">
            <label className="notif-quiet__time-field">
              <span>From</span>
              <input
                type="time"
                className="notif-input notif-input--time"
                value={qh.from}
                onChange={e => onChange({ ...qh, from: e.target.value })}
              />
            </label>
            <span className="notif-quiet__to">to</span>
            <label className="notif-quiet__time-field">
              <span>To</span>
              <input
                type="time"
                className="notif-input notif-input--time"
                value={qh.to}
                onChange={e => onChange({ ...qh, to: e.target.value })}
              />
            </label>
          </div>
        )}
        <button className="notif-btn notif-btn--primary" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [channels, setChannels] = useState<Integration[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [qh, setQh] = useState<QuietHours>({ enabled: false, from: '22:00', to: '08:00' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddRule, setShowAddRule] = useState(false);
  const [savingRules, setSavingRules] = useState(false);
  const [savingQh, setSavingQh] = useState(false);

  useEffect(() => {
    Promise.all([fetchNotifications(), fetchIntegrations()])
      .then(([notifs, integrations]) => {
        setRules(notifs.rules);
        setQh(notifs.quietHours);
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
    try {
      await saveNotificationRules(updated);
      setRules(updated);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleAddRule(rule: NotificationRule) {
    const updated = [...rules, rule];
    setSavingRules(true);
    try {
      await saveNotificationRules(updated);
      setRules(updated);
      setShowAddRule(false);
    } finally {
      setSavingRules(false);
    }
  }

  async function handleSaveQh() {
    setSavingQh(true);
    try {
      await saveQuietHours(qh);
    } finally {
      setSavingQh(false);
    }
  }

  if (loading) return <div className="page-loading">Loading notifications…</div>;
  if (error)   return <div className="page-error">Failed to load notifications: {error}</div>;

  return (
    <div className="notif-page">
      <header className="page-header">
        <h1 className="page-title">Notifications</h1>
        <p className="page-subtitle">Configure how and when Koa reaches out to you.</p>
      </header>

      {/* Channels */}
      <section className="notif-section">
        <h2 className="notif-section__title">Channels</h2>
        {channels.length === 0 ? (
          <p className="notif-empty">
            No notification channels connected. Configure Slack, Pushover, ntfy, or SMTP in{' '}
            <a href="/integrations" className="notif-link">Integrations</a>.
          </p>
        ) : (
          <div className="notif-channels">
            {channels.map(c => <ChannelRow key={c.id} integration={c} />)}
          </div>
        )}
      </section>

      {/* Rules */}
      <section className="notif-section">
        <div className="notif-section__header">
          <h2 className="notif-section__title">Notification Rules</h2>
          <button
            className="notif-btn notif-btn--primary"
            onClick={() => setShowAddRule(v => !v)}
            disabled={channels.length === 0}
            title={channels.length === 0 ? 'Add a notification channel first' : undefined}
          >
            + Add Rule
          </button>
        </div>

        {showAddRule && (
          <AddRuleForm
            channels={channels}
            onAdd={handleAddRule}
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
              <RuleRow
                key={r.id}
                rule={r}
                channels={channels}
                onDelete={handleDeleteRule}
              />
            ))}
          </div>
        )}
        {savingRules && <p className="notif-saving">Saving…</p>}
      </section>

      {/* Quiet hours */}
      <QuietHoursSection
        qh={qh}
        onChange={setQh}
        onSave={handleSaveQh}
        saving={savingQh}
      />
    </div>
  );
}
