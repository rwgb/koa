import { useEffect, useState } from 'react';
import { useAgent } from '../context/AgentContext.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const VERSION = '0.2.0';

function StatusPill({ isThinking, activeTool }: { isThinking: boolean; activeTool: string | null }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isThinking) return;
    const id = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(id);
  }, [isThinking]);

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
        Running: {activeTool}
      </span>
    );
  }

  return (
    <span className="status-pill status-pill--active">
      <span className="status-pill__spinner">{SPINNER_FRAMES[frame]}</span>
      Thinking
    </span>
  );
}

export default function TopNav() {
  const { isThinking, activeTool, usage, agentStatus } = useAgent();

  const tierColor =
    agentStatus?.activeTier === 'haiku'
      ? '#22c55e'
      : agentStatus?.activeTier === 'opus'
        ? '#a855f7'
        : '#3b82f6';

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
            style={{ backgroundColor: tierColor }}
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
