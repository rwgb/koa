import { useState } from 'react';
import type { ChatItem } from '../types.js';
import { Icon } from './Icon.js';

interface Props {
  item: ChatItem;
}

export default function MessageBubble({ item }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (item.kind === 'user') {
    const channelIcon = item.channel === 'sms' ? 'phone'
      : item.channel === 'gmail' ? 'envelope'
      : item.channel === 'slack' ? 'chat'
      : null;
    return (
      <div className="bubble bubble--user">
        <div className="bubble__meta">
          <span className="bubble__role bubble__role--user">You</span>
          {channelIcon && (
            <span className="bubble__channel-badge" title={`via ${item.channel}`}>
              <Icon name={channelIcon} size={11} />
              {item.channel}
            </span>
          )}
        </div>
        <div className="bubble__content">{item.content}</div>
      </div>
    );
  }

  if (item.kind === 'assistant') {
    const tier = item.tier ?? 'sonnet';
    const KNOWN_AGENTS = new Set(['code-assistant', 'project-manager', 'life-manager']);
    const agentLabel: Record<string, string> = {
      'code-assistant': 'Code',
      'project-manager': 'PM',
      'life-manager': 'Life',
    };
    const rawAgent = item.agent ?? 'code-assistant';
    const agent = KNOWN_AGENTS.has(rawAgent) ? rawAgent : 'code-assistant';
    return (
      <div className="bubble bubble--assistant bubble--hoverable">
        <div className="bubble__meta">
          <span className="bubble__role bubble__role--assistant">Koa</span>
          <span className={`bubble__agent-badge bubble__agent-badge--${agent}`}>
            {agentLabel[agent] ?? agent}
          </span>
          <span className={`bubble__tier-badge bubble__tier-badge--${tier}`}>{tier}</span>
          <button
            className="message__copy-btn"
            onClick={() => handleCopy(item.content)}
            aria-label="Copy message"
          >
            {copied
              ? <span className="message__copy-flash">Copied</span>
              : <Icon name="copy" size={12} />}
          </button>
        </div>
        <div className="bubble__content" style={{ whiteSpace: 'pre-wrap' }}>
          {item.content}
        </div>
      </div>
    );
  }

  if (item.kind === 'tool_call') {
    return (
      <div className="bubble bubble--tool">
        <button
          className="bubble__tool-header"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          <Icon name="wrench" size={12} className="bubble__tool-icon" />
          <span className="bubble__tool-name">{item.name}</span>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
        </button>
        {expanded && (
          <pre className="bubble__pre">{JSON.stringify(item.input, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (item.kind === 'tool_result') {
    return (
      <div className="bubble bubble--result">
        <button
          className="bubble__tool-header bubble__tool-header--result"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          <Icon name="check" size={12} className="bubble__tool-icon" />
          <span className="bubble__tool-name">{item.name}</span>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />
        </button>
        {expanded && (
          <pre className="bubble__pre">{item.result}</pre>
        )}
      </div>
    );
  }

  if (item.kind === 'error') {
    return (
      <div className="bubble bubble--error">
        <div className="bubble__meta">
          <Icon name="alert" size={12} />
          <span className="bubble__role bubble__role--error">Error</span>
        </div>
        <div className="bubble__content bubble__content--error">{item.message}</div>
      </div>
    );
  }

  return null;
}
