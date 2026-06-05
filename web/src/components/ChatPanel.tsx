import { useEffect, useRef, useState } from 'react';
import type { ChatItem } from '../types.js';
import MessageBubble from './MessageBubble.js';
import { Icon } from './Icon.js';
import { fetchProjects, createTask } from '../api.js';
import type { Project } from '../types.js';

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
