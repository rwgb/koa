import React, { useState, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { ChatMessage } from './components/ChatMessage.js';
import { Sidebar } from './components/Sidebar.js';
import { StatusBar } from './components/StatusBar.js';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import type { EngramContext, SessionUsageStats } from '../types/index.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  turn: number;
}

interface Props {
  loop: AgentLoop;
  config: KoaConfig;
  engramContext: EngramContext;
}

export function App({ loop, config, engramContext }: Props) {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [sessionUsage, setSessionUsage] = useState<SessionUsageStats | null>(null);
  const [isExiting, setIsExiting] = useState(false);

  const quit = useCallback(() => {
    if (isExiting) return;
    setIsExiting(true);
    loop.finalize().finally(() => exit());
  }, [isExiting, loop, exit]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === 'c') quit();
  });

  const handleSubmit = useCallback(
    async (value: string) => {
      if (!value.trim() || isThinking || isExiting) return;

      const trimmed = value.trim().toLowerCase();
      if (trimmed === '/exit' || trimmed === '/quit' || trimmed === 'exit' || trimmed === 'quit') {
        quit();
        return;
      }

      if (trimmed === '/checkpoint') {
        setInput('');
        setIsThinking(true);
        try {
          await loop.checkpoint();
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: 'Checkpoint saved. STATE.md updated.', turn: turnCount },
          ]);
        } finally {
          setIsThinking(false);
        }
        return;
      }

      const turn = turnCount + 1;
      setTurnCount(turn);
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', content: value, turn }]);
      setIsThinking(true);

      try {
        const result = await loop.turn(value);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.content, turn },
        ]);
        setSessionUsage(loop.getState().usage);
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `Error: ${err instanceof Error ? err.message : String(err)}`,
            turn,
          },
        ]);
      } finally {
        setIsThinking(false);
      }
    },
    [loop, isThinking, isExiting, turnCount, quit],
  );

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1}>
        <Sidebar context={engramContext} projectPath={config.projectPath} />
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} turnNumber={msg.turn} />
          ))}
          {messages.length === 0 && (
            <Box>
              <Text color="gray" dimColor>
                Type a message to start. Type /exit or press Ctrl+C to quit.
              </Text>
            </Box>
          )}
        </Box>
      </Box>
      <StatusBar
        model={config.model}
        turnCount={turnCount}
        engramEnabled={config.engramEnabled}
        isThinking={isThinking}
        usage={sessionUsage}
      />
      <Box paddingX={1}>
        <Box marginRight={1}>
          <Text color="cyan">{'> '}</Text>
        </Box>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          placeholder="Ask Koa anything... (/exit · /checkpoint)"
        />
      </Box>
    </Box>
  );
}
