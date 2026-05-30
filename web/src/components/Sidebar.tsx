import type { EngramContext } from '../types.js';

interface Props {
  context: EngramContext | null;
}

function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

export default function Sidebar({ context }: Props) {
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
    </aside>
  );
}
