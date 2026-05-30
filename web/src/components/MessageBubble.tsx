import { useState } from 'react';
import type { ChatItem } from '../types.js';

interface Props {
  item: ChatItem;
}

export default function MessageBubble({ item }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (item.kind === 'user') {
    return (
      <div className="bubble">
        <span className="bubble__label bubble__label--user">▶ You</span>
        <div className="bubble__content">{item.content}</div>
      </div>
    );
  }

  if (item.kind === 'assistant') {
    const tier = item.tier ?? 'sonnet';
    const badgeStyle: Record<string, string> = {
      haiku: '#22c55e',   // green — cheap
      sonnet: '#3b82f6',  // blue — default
      opus: '#a855f7',    // purple — powerful
    };
    const badgeColor = badgeStyle[tier] ?? badgeStyle['sonnet']!;
    return (
      <div className="bubble">
        <span className="bubble__label bubble__label--assistant">
          ◀ Koa
          <span
            className="bubble__tier-badge"
            style={{ backgroundColor: badgeColor }}
            title={`Model tier: ${tier}`}
          >
            {tier}
          </span>
        </span>
        <div className="bubble__content" style={{ whiteSpace: 'pre-wrap' }}>
          {item.content}
        </div>
      </div>
    );
  }

  if (item.kind === 'tool_call') {
    return (
      <div className="bubble">
        <span
          className="bubble__label bubble__label--tool-call"
          onClick={() => setExpanded(e => !e)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}
        >
          ⚙ tool: {item.name}
          <span className="bubble__toggle">{expanded ? '▲' : '▼'}</span>
        </span>
        {expanded && (
          <pre className="bubble__pre">
            {JSON.stringify(item.input, null, 2)}
          </pre>
        )}
      </div>
    );
  }

  if (item.kind === 'tool_result') {
    return (
      <div className="bubble">
        <span
          className="bubble__label bubble__label--tool-result"
          onClick={() => setExpanded(e => !e)}
          role="button"
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && setExpanded(v => !v)}
        >
          ✓ result: {item.name}
          <span className="bubble__toggle">{expanded ? '▲' : '▼'}</span>
        </span>
        {expanded && (
          <pre className="bubble__pre">{item.result}</pre>
        )}
      </div>
    );
  }

  if (item.kind === 'error') {
    return (
      <div className="bubble">
        <span className="bubble__label bubble__label--error">✗ error</span>
        <div className="bubble__content bubble__content--error">{item.message}</div>
      </div>
    );
  }

  return null;
}
