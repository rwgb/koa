import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { SessionUsageStats } from '../../types/index.js';

interface Props {
  model: string;
  turnCount: number;
  engramEnabled: boolean;
  isThinking: boolean;
  isClassifying?: boolean;
  usage?: SessionUsageStats | null;
}

export function StatusBar({ model, turnCount, engramEnabled, isThinking, isClassifying, usage }: Props) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Text color="magenta">{model.replace('claude-', '')}</Text>
      <Text dimColor> | </Text>
      <Text>turns: {turnCount}</Text>
      <Text dimColor> | </Text>
      <Text color={engramEnabled ? 'green' : 'red'}>
        engram: {engramEnabled ? 'on' : 'off'}
      </Text>
      {usage && usage.turnsCount > 0 && (
        <>
          <Text dimColor> | </Text>
          <Text color="yellow">
            ${usage.estimatedCostUsd.toFixed(4)} | {Math.round(usage.cacheHitRate * 100)}% cache
          </Text>
        </>
      )}
      {isClassifying && (
        <>
          <Text dimColor> | </Text>
          <Text color="cyan">
            <Spinner type="dots" />
            {' classifying'}
          </Text>
        </>
      )}
      {isThinking && !isClassifying && (
        <>
          <Text dimColor> | </Text>
          <Text color="yellow">
            <Spinner type="dots" />
            {' thinking'}
          </Text>
        </>
      )}
      <Box flexGrow={1} />
      <Text dimColor>/exit or ctrl+c</Text>
    </Box>
  );
}
