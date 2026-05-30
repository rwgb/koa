import type { EngramContext, SessionUsageStats } from '../types.js';

interface Props {
  context: EngramContext | null;
  usage?: SessionUsageStats | null;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export default function Sidebar({ context, usage }: Props) {
  if (!context) {
    return (
      <aside className="sidebar">
        <p className="sidebar__offline">Engram offline</p>
      </aside>
    );
  }

  const hotFiles = context.hotFiles.slice(0, 8);
  const summaryTruncated =
    context.sessionSummary && context.sessionSummary.length > 150
      ? context.sessionSummary.slice(0, 150) + '…'
      : context.sessionSummary;

  return (
    <aside className="sidebar">
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
    </aside>
  );
}
