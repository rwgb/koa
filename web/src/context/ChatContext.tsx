import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { fetchConversationTurns, fetchStatus, streamChat } from '../api.js';
import { useAgent } from './AgentContext.js';
import type { ChatItem, SseEvent } from '../types.js';
import { useSpeech, type VoiceState } from '../hooks/useSpeech.js';

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ChatContextValue {
  items: ChatItem[];
  classifyingTier: string | null;
  sendMessage: (text: string) => void;
  clearChat: () => void;
  voice: VoiceState;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Owns the chat transcript and the in-flight SSE stream. Mounted above the
 * router outlet (in RootLayout) so navigating between pages neither aborts a
 * streaming reply nor destroys the transcript — replies that arrive while the
 * chat page is unmounted render as soon as the user returns.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [classifyingTier, setClassifyingTier] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const lastTierRef = useRef<string>('sonnet');
  const lastAgentRef = useRef<string>('code-assistant');
  const hydratedRef = useRef(false);

  const { isThinking, setIsThinking, setActiveTool, setUsage, setAgentStatus, setContextStats, agentStatus } = useAgent();
  const voice = useSpeech();
  const speakBufferRef = useRef('');

  // Sync lastTierRef with the server-reported tier (before any turns, reflects config model)
  useEffect(() => {
    if (agentStatus?.activeTier) {
      lastTierRef.current = agentStatus.activeTier;
    }
  }, [agentStatus?.activeTier]);

  // Hydrate the transcript from the server's active conversation once status loads.
  // conversationId is null before the first turn (lazy creation) — empty chat is correct then.
  useEffect(() => {
    if (hydratedRef.current || !agentStatus) return;
    hydratedRef.current = true;
    const convId = agentStatus.conversationId;
    if (!convId) return;
    fetchConversationTurns(convId)
      .then(turns => {
        setItems(prev => {
          // Live events beat hydration — never clobber an in-progress transcript
          if (prev.length > 0) return prev;
          return turns.map<ChatItem>(t =>
            t.role === 'user'
              ? { kind: 'user', content: t.content, id: t.id }
              : { kind: 'assistant', content: t.content, id: t.id, agent: t.agent_name ?? undefined },
          );
        });
      })
      .catch(err => {
        console.error('Failed to hydrate chat transcript:', err);
        setItems(prev => {
          if (prev.length > 0) return prev;
          return [{ kind: 'error', message: 'Could not load conversation history — starting fresh.', id: crypto.randomUUID() }];
        });
      });
  }, [agentStatus]);

  // Abort the stream only when the provider itself unmounts (full app teardown) —
  // never on route navigation, which was the original bug.
  useEffect(() => () => { cancelRef.current?.(); }, []);

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;

    cancelRef.current?.();

    setIsThinking(true);
    setActiveTool(null);
    setClassifyingTier(null);

    setItems(prev => [...prev, { kind: 'user', content: trimmed, id: makeId() }]);

    const cancel = streamChat(
      trimmed,
      (event: SseEvent) => {
        if (event.type === 'done') {
          lastTierRef.current = event.tier;
          lastAgentRef.current = event.agent ?? 'code-assistant';
          const textToSpeak = speakBufferRef.current;
          speakBufferRef.current = '';
          if (textToSpeak) voice.speak(textToSpeak);
          setActiveTool(null);
          setAgentStatus(prev =>
            prev
              ? { ...prev, turnCount: event.turnCount, activeModel: event.model, activeTier: event.tier, activeAgent: event.agent }
              : prev,
          );
          return;
        }
        if (event.type === 'usage') {
          setUsage(event.session);
          if (event.contextStats) setContextStats(event.contextStats);
          return;
        }
        if (event.type === 'classifying') {
          setClassifyingTier('…');
          return;
        }
        if (event.type === 'classified') {
          setClassifyingTier(`→ ${event.tier}`);
          return;
        }
        if (event.type === 'content') {
          speakBufferRef.current += event.text;
          setClassifyingTier(null);
          setItems(prev => {
            const last = prev[prev.length - 1];
            if (last?.kind === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: last.content + event.text }];
            }
            return [...prev, { kind: 'assistant', content: event.text, id: makeId(), tier: lastTierRef.current, agent: lastAgentRef.current }];
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
        setClassifyingTier(null);
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
        setClassifyingTier(null);
        setItems(prev => [...prev, { kind: 'error', message: msg, id: makeId() }]);
      },
    );

    cancelRef.current = cancel;
  };

  const clearChat = () => setItems([]);

  return (
    <ChatContext.Provider value={{ items, classifyingTier, sendMessage, clearChat, voice }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
