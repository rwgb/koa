import { useAgent } from '../context/AgentContext.js';

const VERSION = '0.2.0';

function StatusPill({ isThinking, activeTool }: { isThinking: boolean; activeTool: string | null }) {
  if (!isThinking) {
    return (
      <span className="status-pill status-pill--idle">
        <span className="status-pill__dot" />
        Idle
      </span>
    );
  }

  if (activeTool) {
    return (
      <span className="status-pill status-pill--active">
        <span className="status-pill__dot status-pill__dot--pulse" />
        {activeTool}
      </span>
    );
  }

  return (
    <span className="status-pill status-pill--active">
      <span className="status-pill__spinner" aria-hidden="true" />
      Thinking
    </span>
  );
}

export default function TopNav() {
  const { isThinking, activeTool, usage, agentStatus } = useAgent();

  const tierColor =
    agentStatus?.activeTier === 'haiku'
      ? 'var(--green)'
      : agentStatus?.activeTier === 'opus'
        ? 'var(--purple)'
        : 'var(--blue)';

  return (
    <header className="top-nav">
      <div className="top-nav__left">
        <span className="top-nav__brand">Koa</span>
        <span className="top-nav__version">v{VERSION}</span>
      </div>

      <div className="top-nav__center">
        <StatusPill isThinking={isThinking} activeTool={activeTool} />
      </div>

      <div className="top-nav__right">
        {usage && usage.estimatedCostUsd > 0 && (
          <span className="top-nav__cost">${usage.estimatedCostUsd.toFixed(4)}</span>
        )}
        {agentStatus && (
          <span
            className="top-nav__model-badge"
            style={{ color: tierColor }}
            title={agentStatus.activeModel ?? agentStatus.model}
          >
            {agentStatus.activeTier ?? 'sonnet'}
          </span>
        )}
        {agentStatus && (
          <span className="top-nav__turns">{agentStatus.turnCount} turns</span>
        )}
      </div>
    </header>
  );
}
