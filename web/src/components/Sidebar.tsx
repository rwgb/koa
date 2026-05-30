import { useEffect, useState } from 'react';
import type { AgentStatus, EngramContext, SessionUsageStats, SpiderBrainContext } from '../types.js';

interface Props {
  context: EngramContext | null;
  usage?: SessionUsageStats | null;
  spiderBrain?: SpiderBrainContext | null;
  status?: AgentStatus | null;
}

type Tab = 'memory' | 'structure' | 'settings';

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function MemoryTab({ context, usage }: { context: EngramContext | null; usage?: SessionUsageStats | null }) {
  if (!context) {
    return <p className="sidebar__offline">Engram offline</p>;
  }

  const hotFiles = context.hotFiles.slice(0, 8);
  const summaryTruncated =
    context.sessionSummary && context.sessionSummary.length > 150
      ? context.sessionSummary.slice(0, 150) + '…'
      : context.sessionSummary;

  return (
    <>
      <div className="sidebar__section">
        <div className="sidebar__heading">Project</div>
      </div>

      {context.goal && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Goal</div>
          <div className="sidebar__goal">{context.goal}</div>
        </div>
      )}

      {hotFiles.length > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Hot Files</div>
          {hotFiles.map(f => (
            <div key={f.path} className="sidebar__file" title={f.path}>
              {basename(f.path)}
            </div>
          ))}
        </div>
      )}

      {context.masterFiles.length > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Masters</div>
          {context.masterFiles.map(f => (
            <div key={f} className="sidebar__master" title={f}>
              {basename(f)}
            </div>
          ))}
        </div>
      )}

      {summaryTruncated && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Last Session</div>
          <div className="sidebar__summary">{summaryTruncated}</div>
        </div>
      )}

      {usage && usage.turnsCount > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Token Usage</div>
          <div className="sidebar__usage-row">
            <span className="sidebar__usage-label">Input</span>
            <span className="sidebar__usage-value">{usage.inputTokens.toLocaleString()}</span>
          </div>
          <div className="sidebar__usage-row">
            <span className="sidebar__usage-label">Output</span>
            <span className="sidebar__usage-value">{usage.outputTokens.toLocaleString()}</span>
          </div>
          <div className="sidebar__usage-row">
            <span className="sidebar__usage-label">Cache write</span>
            <span className="sidebar__usage-value">{usage.cacheWriteTokens.toLocaleString()}</span>
          </div>
          <div className="sidebar__usage-row">
            <span className="sidebar__usage-label">Cache read</span>
            <span className="sidebar__usage-value">{usage.cacheReadTokens.toLocaleString()}</span>
          </div>
          <div className="sidebar__usage-row">
            <span className="sidebar__usage-label">Cache hit</span>
            <span className="sidebar__usage-value">{Math.round(usage.cacheHitRate * 100)}%</span>
          </div>
          <div className="sidebar__usage-row">
            <span className="sidebar__usage-label">Cost</span>
            <span className="sidebar__usage-value">${usage.estimatedCostUsd.toFixed(4)}</span>
          </div>
        </div>
      )}
    </>
  );
}

function StructureTab({ spiderBrain }: { spiderBrain?: SpiderBrainContext | null }) {
  if (!spiderBrain?.available) {
    return (
      <div className="sidebar__section">
        <p className="sidebar__offline">SpiderBrain not indexed</p>
        <p className="sidebar__offline" style={{ marginTop: 8 }}>
          Run: <code>koa brain build</code>
        </p>
      </div>
    );
  }

  const masters = spiderBrain.masters.slice(0, 8);
  const hotFiles = spiderBrain.hotFiles.slice(0, 8);

  return (
    <div className="sidebar__spiderbrain">
      {spiderBrain.prey && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Prey</div>
          <div className="sidebar__prey">{spiderBrain.prey}</div>
        </div>
      )}

      {masters.length > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Masters</div>
          {masters.map(m => (
            <div key={m.id} className="sidebar__master-row">
              <span className={`sidebar__webscore${m.webscore >= 9 ? ' sidebar__webscore--critical' : ''}`}>
                {m.webscore >= 9 ? '★' : ''}{m.webscore.toFixed(1)}
              </span>
              <span className="sidebar__master-name" title={m.id}>{basename(m.id)}</span>
              <span className="sidebar__master-cluster">{m.cluster}</span>
            </div>
          ))}
        </div>
      )}

      {hotFiles.length > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Hot Files</div>
          {hotFiles.map(f => (
            <div key={f} className="sidebar__file sidebar__file--dim" title={f}>
              {basename(f)}
            </div>
          ))}
        </div>
      )}

      {spiderBrain.clusterNames.length > 0 && (
        <div className="sidebar__section">
          <div className="sidebar__heading">Clusters</div>
          <div className="sidebar__clusters">{spiderBrain.clusterNames.join(', ')}</div>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ status, spiderBrain }: { status?: AgentStatus | null; spiderBrain?: SpiderBrainContext | null }) {
  const model = status?.activeModel ?? status?.model ?? '—';
  const tier = status?.activeTier ?? '—';
  const engramOn = status?.engramEnabled ?? false;
  const sbAvailable = spiderBrain?.available ?? false;
  const projectPath = status?.projectPath ?? 'unknown';

  return (
    <div className="sidebar__section">
      <div className="sidebar__settings-row">
        <span className="sidebar__settings-label">Model</span>
        <span className="sidebar__settings-value">{model}</span>
      </div>
      <div className="sidebar__settings-row">
        <span className="sidebar__settings-label">Tier</span>
        <span className="sidebar__settings-value">{tier}</span>
      </div>
      <div className="sidebar__settings-row">
        <span className="sidebar__settings-label">Engram</span>
        <span className={`sidebar__settings-value sidebar__settings-indicator${engramOn ? '--on' : '--off'}`}>
          {engramOn ? 'on' : 'off'}
        </span>
      </div>
      <div className="sidebar__settings-row">
        <span className="sidebar__settings-label">SpiderBrain</span>
        <span className={`sidebar__settings-value sidebar__settings-indicator${sbAvailable ? '--on' : '--off'}`}>
          {sbAvailable ? 'indexed' : 'not indexed'}
        </span>
      </div>
      <div className="sidebar__settings-row">
        <span className="sidebar__settings-label">Project</span>
        <span className="sidebar__settings-value sidebar__settings-path" title={projectPath}>
          {projectPath === 'unknown' ? 'unknown' : basename(projectPath)}
        </span>
      </div>
      {!status && (
        <div className="sidebar__settings-row" style={{ marginTop: 12 }}>
          <span className="sidebar__settings-label" style={{ color: 'var(--text-muted)' }}>
            koa config set api-key &lt;key&gt;
          </span>
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ context, usage, spiderBrain, status }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('memory');
  const [autoSwitched, setAutoSwitched] = useState(false);

  // Auto-switch to 'structure' tab once, when SpiderBrain becomes available after initial load
  useEffect(() => {
    if (!autoSwitched && spiderBrain?.available) {
      setActiveTab('structure');
      setAutoSwitched(true);
    }
  }, [spiderBrain?.available, autoSwitched]);

  return (
    <aside className="sidebar">
      <div className="sidebar__tabs">
        <button
          className={`sidebar__tab${activeTab === 'memory' ? ' sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('memory')}
        >
          MEM
        </button>
        <button
          className={`sidebar__tab${activeTab === 'structure' ? ' sidebar__tab--active sidebar__tab--sb' : ''}`}
          onClick={() => setActiveTab('structure')}
        >
          SB
        </button>
        <button
          className={`sidebar__tab${activeTab === 'settings' ? ' sidebar__tab--active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          CFG
        </button>
      </div>

      <div className="sidebar__tab-content">
        {activeTab === 'memory' && <MemoryTab context={context} usage={usage} />}
        {activeTab === 'structure' && <StructureTab spiderBrain={spiderBrain} />}
        {activeTab === 'settings' && <SettingsTab status={status} spiderBrain={spiderBrain} />}
      </div>
    </aside>
  );
}
