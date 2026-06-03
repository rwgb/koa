import { useEffect, useState } from 'react';
import { useAgent } from '../context/AgentContext.js';
import { fetchHealth } from '../api.js';
import type { HealthStatus } from '../types.js';

const VERSION = '0.2.0';

function HealthPill() {
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    const check = () => {
      fetchHealth().then(setHealth).catch(() => setHealth(null));
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const dotClass = health === null
    ? 'top-nav__health-dot'
    : health.db === 'ok'
      ? 'top-nav__health-dot top-nav__health-dot--ok'
      : 'top-nav__health-dot top-nav__health-dot--error';

  const title = health === null
    ? 'Health unknown'
    : health.db === 'ok'
      ? `DB ok — uptime ${Math.floor(health.uptime / 3600)}h`
      : 'DB error';

  return (
    <span className="top-nav__health" title={title}>
      <span className={dotClass} />
    </span>
  );
}

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
        <HealthPill />
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
