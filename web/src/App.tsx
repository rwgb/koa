import { useEffect, useRef, useState } from 'react';
import { fetchStatus, streamChat } from './api.js';
import type { AgentStatus, ChatItem, SessionUsageStats, SpiderBrainContext, SseEvent } from './types.js';
import StatusBar from './components/StatusBar.js';
import Sidebar from './components/Sidebar.js';
import ChatPanel from './components/ChatPanel.js';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function App() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [input, setInput] = useState('');
  const [sessionUsage, setSessionUsage] = useState<SessionUsageStats | null>(null);
  const [spiderBrain, setSpiderBrain] = useState<SpiderBrainContext | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  // Track the tier of the most recent completed turn so assistant bubbles can be badged
  const lastTierRef = useRef<string>('sonnet');

  useEffect(() => {
    fetchStatus()
      .then(s => {
        setStatus(s);
        if (s.usage) setSessionUsage(s.usage);
        setSpiderBrain(s.spiderBrain ?? null);
      })
      .catch(err => console.error('Failed to load status:', err));

    return () => {
      cancelRef.current?.();
    };
  }, []);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

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
        if (event.type === 'content') {
          setItems(prev => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: last.content + event.text }];
            }
            return [...prev, { kind: 'assistant', content: event.text, id: makeId(), tier: lastTierRef.current }];
          });
          return;
        }
        if (event.type === 'tool_call') {
          setItems(prev => [...prev, { kind: 'tool_call', name: event.name, input: event.input, id: makeId() }]);
          return;
        }
        if (event.type === 'tool_result') {
          setItems(prev => [...prev, { kind: 'tool_result', name: event.name, result: event.result, id: makeId() }]);
          return;
        }
        if (event.type === 'error') {
          setItems(prev => [...prev, { kind: 'error', message: event.message, id: makeId() }]);
        }
      },
      () => {
        setIsThinking(false);
        fetchStatus()
          .then(s => {
            setStatus(s);
            if (s.usage) setSessionUsage(s.usage);
            setSpiderBrain(s.spiderBrain ?? null);
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
      <StatusBar status={status} isThinking={isThinking} usage={sessionUsage} spiderBrain={spiderBrain} />
      <div className="main">
        <Sidebar context={status?.context ?? null} usage={sessionUsage} spiderBrain={spiderBrain} status={status} />
        <ChatPanel
          items={items}
          input={input}
          setInput={setInput}
          onSubmit={handleSubmit}
          isThinking={isThinking}
          onClear={() => setItems([])}
        />
      </div>
    </div>
  );
}
