import React from 'react';
import { Box, Text } from 'ink';
import type { EngramContext } from '../../types/index.js';

interface Props {
  context: EngramContext;
  projectPath: string;
}

export function Sidebar({ context, projectPath }: Props) {
  const projectName = projectPath.split('/').pop() ?? projectPath;

  return (
    <Box
      flexDirection="column"
      width={30}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginRight={1}
    >
      <Text bold color="yellow">
        {projectName}
      </Text>

      {context.goal && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            GOAL
          </Text>
          <Text wrap="wrap" color="white">
            {context.goal}
          </Text>
        </Box>
      )}

      {context.hotFiles.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            HOT FILES
          </Text>
          {context.hotFiles.slice(0, 8).map((f) => (
            <Text key={f.path} color="cyan" wrap="truncate">
              {f.path.split('/').pop()}
            </Text>
          ))}
        </Box>
      )}

      {context.sessionSummary && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            LAST SESSION
          </Text>
          <Text wrap="wrap" dimColor>
            {context.sessionSummary.slice(0, 120)}
          </Text>
        </Box>
      )}

      {context.hotFiles.length === 0 && !context.goal && (
        <Box marginTop={1}>
          <Text dimColor>No Engram context</Text>
        </Box>
      )}
    </Box>
  );
}
