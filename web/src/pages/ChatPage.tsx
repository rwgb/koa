import { useEffect, useRef, useState } from 'react';
import { fetchStatus, streamChat } from '../api.js';
import { useAgent } from '../context/AgentContext.js';
import type { ChatItem, SseEvent } from '../types.js';
import ChatPanel from '../components/ChatPanel.js';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function ChatPage() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const cancelRef = useRef<(() => void) | null>(null);
  const lastTierRef = useRef<string>('sonnet');

  const { isThinking, setIsThinking, setActiveTool, setUsage, setAgentStatus } = useAgent();

  useEffect(() => {
    fetchStatus()
      .then(s => {
        setAgentStatus(s);
        if (s.usage) setUsage(s.usage);
      })
      .catch(err => console.error('Failed to load status:', err));

    return () => {
      cancelRef.current?.();
    };
  }, [setAgentStatus, setUsage]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;

    cancelRef.current?.();

    setInput('');
    setIsThinking(true);
    setActiveTool(null);

    setItems(prev => [...prev, { kind: 'user', content: trimmed, id: makeId() }]);

    const cancel = streamChat(
      trimmed,
      (event: SseEvent) => {
        if (event.type === 'done') {
          lastTierRef.current = event.tier;
          setActiveTool(null);
          setAgentStatus(prev =>
            prev
              ? { ...prev, turnCount: event.turnCount, activeModel: event.model, activeTier: event.tier }
              : prev,
          );
          return;
        }
        if (event.type === 'usage') {
          setUsage(event.session);
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
          setActiveTool(event.name);
          setItems(prev => [...prev, { kind: 'tool_call', name: event.name, input: event.input, id: makeId() }]);
          return;
        }
        if (event.type === 'tool_result') {
          setActiveTool(null);
          setItems(prev => [...prev, { kind: 'tool_result', name: event.name, result: event.result, id: makeId() }]);
          return;
        }
        if (event.type === 'error') {
          setItems(prev => [...prev, { kind: 'error', message: event.message, id: makeId() }]);
        }
      },
      () => {
        setIsThinking(false);
        setActiveTool(null);
        fetchStatus()
          .then(s => {
            setAgentStatus(s);
            if (s.usage) setUsage(s.usage);
          })
          .catch(() => undefined);
      },
      (msg: string) => {
        setIsThinking(false);
        setActiveTool(null);
        setItems(prev => [...prev, { kind: 'error', message: msg, id: makeId() }]);
      },
    );

    cancelRef.current = cancel;
  };

  return (
    <ChatPanel
      items={items}
      input={input}
      setInput={setInput}
      onSubmit={handleSubmit}
      isThinking={isThinking}
      onClear={() => setItems([])}
    />
  );
}
