import { useEffect, useState } from 'react';
import { fetchStatus } from '../api.js';
import { useAgent } from '../context/AgentContext.js';
import { useChat } from '../context/ChatContext.js';
import ChatPanel from '../components/ChatPanel.js';

// Thin consumer — the transcript and the SSE stream live in ChatProvider
// (mounted in RootLayout), so navigating away never aborts an in-flight reply.
export default function ChatPage() {
  const [input, setInput] = useState('');

  const { isThinking, setUsage, setAgentStatus } = useAgent();
  const { items, classifyingTier, sendMessage, clearChat } = useChat();

  // Refresh agent status on each visit to the chat page
  useEffect(() => {
    fetchStatus()
      .then(s => {
        setAgentStatus(s);
        if (s.usage) setUsage(s.usage);
      })
      .catch(err => console.error('Failed to load status:', err));
  }, [setAgentStatus, setUsage]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isThinking) return;
    setInput('');
    sendMessage(trimmed);
  };

  return (
    <ChatPanel
      items={items}
      input={input}
      setInput={setInput}
      onSubmit={handleSubmit}
      isThinking={isThinking}
      classifyingTier={classifyingTier}
      onClear={clearChat}
    />
  );
}
