import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  role: 'user' | 'assistant';
  content: string;
  turnNumber?: number;
}

export function ChatMessage({ role, content, turnNumber }: Props) {
  const isUser = role === 'user';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text bold color={isUser ? 'cyan' : 'green'}>
          {isUser ? '▶ You' : '◀ Koa'}
        </Text>
        {turnNumber !== undefined && (
          <Text dimColor>
            {' '}
            #{turnNumber}
          </Text>
        )}
      </Box>
      <Box paddingLeft={2}>
        <Text wrap="wrap">{content}</Text>
      </Box>
    </Box>
  );
}
