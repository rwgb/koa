import { useEffect, useRef } from 'react';
import type { ChatItem } from '../types.js';
import MessageBubble from './MessageBubble.js';
import { Icon } from './Icon.js';

interface Props {
  items: ChatItem[];
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void;
  isThinking: boolean;
  classifyingTier?: string | null;
  onClear: () => void;
}

export default function ChatPanel({ items, input, setInput, onSubmit, isThinking, classifyingTier, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat__header">
        <span className="chat__header-title">Chat</span>
        {items.length > 0 && (
          <button className="chat__clear-btn" onClick={onClear} aria-label="Clear conversation">
            <Icon name="trash" size={13} />
          </button>
        )}
      </div>

      <div className="messages">
        {items.length === 0 ? (
          <div className="messages__empty">
            Type a message to start · Engram memory is active
          </div>
        ) : (
          items.map(item => <MessageBubble key={item.id} item={item} />)
        )}
        <div ref={bottomRef} />
      </div>

      {classifyingTier && (
        <div className="classifying-badge">Routing{classifyingTier !== '…' ? ` → ${classifyingTier}` : '…'}</div>
      )}

      <div className="input-row">
        <input
          className="input-row__input"
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isThinking}
          placeholder="Ask Koa anything…"
          autoFocus
        />
        <button
          className="input-row__send"
          onClick={onSubmit}
          disabled={isThinking || !input.trim()}
          aria-label="Send message"
        >
          <Icon name="send" size={15} />
        </button>
      </div>
    </div>
  );
}
