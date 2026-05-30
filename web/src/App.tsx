import { useEffect, useRef, useState } from 'react';
import { fetchStatus, streamChat } from './api.js';
import type { AgentStatus, ChatItem, SessionUsageStats, SseEvent } from './types.js';
import StatusBar from './components/StatusBar.js';
import Sidebar from './components/Sidebar.js';
import ChatPanel from './components/ChatPanel.js';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function sseEventToChatItem(e: SseEvent, currentTier: string): ChatItem | null {
  if (e.type === 'content') {
    return { kind: 'assistant', content: e.text, id: makeId(), tier: currentTier };
  }
  if (e.type === 'tool_call') {
    return { kind: 'tool_call', name: e.name, input: e.input, id: makeId() };
  }
  if (e.type === 'tool_result') {
    return { kind: 'tool_result', name: e.name, result: e.result, id: makeId() };
  }
  if (e.type === 'error') {
    return { kind: 'error', message: e.message, id: makeId() };
  }
  // 'done' — handled separately
  return null;
}

export default function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [input, setInput] = useState('');
  const [sessionUsage, setSessionUsage] = useState<SessionUsageStats | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  // Track the tier of the most recent completed turn so assistant bubbles can be badged
  const lastTierRef = useRef<string>('sonnet');

  useEffect(() => {
    fetchStatus()
      .then(s => {
        setStatus(s);
        if (s.usage) setSessionUsage(s.usage);
      })
      .catch(err => console.error('Failed to load status:', err));

    return () => {
      cancelRef.current?.();
    };
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    // Cancel any in-flight request
    cancelRef.current?.();

    setInput('');
    setIsThinking(true);

    setItems(prev => [
      ...prev,
      { kind: 'user', content: trimmed, id: makeId() },
    ]);

    const cancel = streamChat(
      trimmed,
      (event: SseEvent) => {
        if (event.type === 'done') {
          lastTierRef.current = event.tier;
          setStatus(prev =>
            prev
              ? { ...prev, turnCount: event.turnCount, activeModel: event.model, activeTier: event.tier }
              : prev,
          );
          return;
        }
        if (event.type === 'usage') {
          setSessionUsage(event.session);
          return;
        }
        const item = sseEventToChatItem(event, lastTierRef.current);
        if (item) {
          setItems(prev => [...prev, item]);
        }
      },
      () => {
        setIsThinking(false);
        // Refresh status to pick up any context changes
        fetchStatus()
          .then(s => {
            setStatus(s);
            if (s.usage) setSessionUsage(s.usage);
          })
          .catch(() => undefined);
      },
      (msg: string) => {
        setIsThinking(false);
        setItems(prev => [
          ...prev,
          { kind: 'error', message: msg, id: makeId() },
        ]);
      },
    );

    cancelRef.current = cancel;
  };

  return (
    <div className="app">
      <StatusBar status={status} isThinking={isThinking} usage={sessionUsage} />
      <div className="main">
        <Sidebar context={status?.context ?? null} usage={sessionUsage} />
        <ChatPanel
          items={items}
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isThinking={isThinking}
        />
      </div>
    </div>
  );
}
