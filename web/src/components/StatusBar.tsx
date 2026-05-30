import { useState, useEffect } from 'react';
import type { AgentStatus } from '../types.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface Props {
  status: AgentStatus | null;
  isThinking: boolean;
}

export default function StatusBar({ status, isThinking }: Props) {
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
          <span className="status-bar__turns">turns: {status.turnCount}</span>
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
