import { useEffect, useRef, useState } from 'react';
import type { ChatItem } from '../types.js';
import MessageBubble from './MessageBubble.js';
import { Icon } from './Icon.js';
import { fetchProjects, createTask } from '../api.js';
import type { Project } from '../types.js';
import type { VoiceState } from '../hooks/useSpeech.js';

function QuickTaskAdd() {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && projects.length === 0) {
      fetchProjects().then(setProjects).catch(() => {});
    }
  }, [open]);

  async function handleAdd() {
    if (!projectId || !title.trim()) return;
    setSaving(true);
    try {
      await createTask(projectId, title.trim());
      setTitle('');
      setToast({ msg: 'Task added', ok: true });
    } catch {
      setToast({ msg: 'Failed to add task', ok: false });
    } finally {
      setSaving(false);
      setTimeout(() => setToast(null), 2000);
    }
  }

  return (
    <div className="quick-task">
      <button className="quick-task__toggle" onClick={() => setOpen(o => !o)}>
        <Icon name="plus" size={12} />
        Quick task
      </button>
      {open && (
        <div className="quick-task__form">
          <select
            className="quick-task__select"
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
          >
            <option value="">Project…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input
            className="quick-task__input"
            placeholder="Task title…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleAdd(); }}
          />
          <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={saving || !projectId || !title.trim()}>
            Add
          </button>
        </div>
      )}
      {toast && (
        <div className={`quick-task__toast quick-task__toast--${toast.ok ? 'ok' : 'err'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [items]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const supportsVoice = typeof window !== 'undefined' && 'speechSynthesis' in window;

  return (
    <div className="chat-panel">
      <div className="chat__header">
        <span className="chat__header-title">Chat</span>
        <div className="chat__header-actions">
          {supportsVoice && (
            <>
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
              {voice.enabled && voice.voices.length > 0 && (
                <select
                  className="chat__voice-select"
                  value={voice.selectedVoiceName}
                  onChange={e => voice.setSelectedVoiceName(e.target.value)}
                  aria-label="Select voice"
                  title="Select voice"
                >
                  {voice.voices.map(v => (
                    <option key={v.name} value={v.name}>{v.name}</option>
                  ))}
                </select>
              )}
            </>
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

      <QuickTaskAdd />

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
