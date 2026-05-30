import React from 'react';
import { Box, Text } from 'ink';

interface Props {
  model: string;
  turnCount: number;
  engramEnabled: boolean;
  isThinking: boolean;
}

export function StatusBar({ model, turnCount, engramEnabled, isThinking }: Props) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="magenta">{model.replace('claude-', '')}</Text>
      <Text dimColor> | </Text>
      <Text>turns: {turnCount}</Text>
      <Text dimColor> | </Text>
      <Text color={engramEnabled ? 'green' : 'red'}>
        engram: {engramEnabled ? 'on' : 'off'}
      </Text>
      {isThinking && (
        <>
          <Text dimColor> | </Text>
          <Text color="yellow">thinking...</Text>
        </>
      )}
      <Box flexGrow={1} />
      <Text dimColor>ctrl+c to exit</Text>
    </Box>
  );
}
