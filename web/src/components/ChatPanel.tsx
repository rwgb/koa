import { useEffect, useRef } from 'react';
import type { ChatItem } from '../types.js';
import MessageBubble from './MessageBubble.js';
import { Icon } from './Icon.js';
import type { VoiceState } from '../hooks/useSpeech.js';
import { useDevMode } from '../context/DevModeContext.js';

interface Props {
  items: ChatItem[];
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void;
  isThinking: boolean;
  classifyingTier?: string | null;
  onClear: () => void;
  voice: VoiceState;
}

export default function ChatPanel({ items, input, setInput, onSubmit, isThinking, classifyingTier, onClear, voice }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const { devMode, toggleDevMode } = useDevMode();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat__header">
        <span className="chat__header-title">Chat</span>
        <div className="chat__header-actions">
          {voice.available && (
            <button
              className={`chat__voice-btn${voice.enabled ? ' chat__voice-btn--on' : ''}`}
              onClick={() => voice.setEnabled(!voice.enabled)}
              aria-label={voice.enabled ? 'Disable voice' : 'Enable voice'}
              title={voice.enabled ? 'Voice on — click to mute' : 'Voice off — click to enable'}
            >
              {voice.enabled ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M5 5H2a1 1 0 00-1 1v3a1 1 0 001 1h3l4 3V2L5 5z" />
                  <path d="M11.5 5.5a3 3 0 010 4.5" />
                  <path d="M13.5 3.5a6 6 0 010 8.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13">
                  <path d="M5 5H2a1 1 0 00-1 1v3a1 1 0 001 1h3l4 3V2L5 5z" />
                  <path d="M13 5l-4 5M13 10l-4-5" />
                </svg>
              )}
            </button>
          )}
          {items.length > 0 && (
            <button className="chat__clear-btn" onClick={onClear} aria-label="Clear conversation">
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
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
        <textarea
          className="input-row__input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={e => {
            const t = e.currentTarget;
            t.style.height = 'auto';
            t.style.height = Math.min(t.scrollHeight, 120) + 'px';
          }}
          disabled={isThinking}
          placeholder="Ask Koa anything…"
          autoFocus
          rows={1}
          style={{ resize: 'none', overflow: 'hidden' }}
        />
        <button
          className={`input-row__dev-toggle${devMode ? ' input-row__dev-toggle--active' : ''}`}
          onClick={toggleDevMode}
          type="button"
          title="Toggle dev mode"
          aria-pressed={devMode}
        >
          Dev
        </button>
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
