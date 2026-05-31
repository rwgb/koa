import { useState, useEffect } from 'react';
import type { AgentStatus, SessionUsageStats, SpiderBrainContext } from '../types.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface Props {
  status: AgentStatus | null;
  isThinking: boolean;
  usage?: SessionUsageStats | null;
  spiderBrain?: SpiderBrainContext | null;
}

export default function StatusBar({ status, isThinking, usage, spiderBrain }: Props) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isThinking) return;
    const id = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [isThinking]);

  return (
    <div className="status-bar">
      {status ? (
        <>
          <span className="status-bar__model">{status.model}</span>
          {status.activeTier && (
            <span
              className="status-bar__active-tier"
              style={{
                backgroundColor:
                  status.activeTier === 'haiku'
                    ? '#22c55e'
                    : status.activeTier === 'opus'
                      ? '#a855f7'
                      : '#3b82f6',
              }}
              title={`Active model: ${status.activeModel ?? status.model}`}
            >
              {status.activeTier}
            </span>
          )}
          <span className="status-bar__turns">turns: {status.turnCount}</span>
          {usage && usage.estimatedCostUsd > 0 && (
            <span className="status-bar__cost">${usage.estimatedCostUsd.toFixed(4)}</span>
          )}
          <span className="status-bar__engram">
            <span
              className={`status-bar__engram-dot ${
                status.engramEnabled
                  ? 'status-bar__engram-dot--on'
                  : 'status-bar__engram-dot--off'
              }`}
            />
            engram
          </span>
          <span className="status-bar__spiderbrain">
            <span
              className={`status-bar__sb-dot ${
                spiderBrain?.available
                  ? 'status-bar__sb-dot--on'
                  : 'status-bar__sb-dot--off'
              }`}
            />
            SB
          </span>
        </>
      ) : (
        <span className="status-bar__turns">connecting...</span>
      )}

      {isThinking && (
        <span className="status-bar__spinner" aria-label="thinking">
          {SPINNER_FRAMES[frame]}
        </span>
      )}

      <span className="status-bar__right status-bar__brand">Koa</span>
    </div>
  );
}
