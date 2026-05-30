import { execaCommand } from 'execa';
import type { Tool, ToolInput } from '../../types/index.js';

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Execute a shell command in the project directory. Use for running scripts, checking git status, installing packages, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000)',
      },
    },
    required: ['command'],
  },
  async execute(input: ToolInput): Promise<string> {
    const command = input['command'] as string;
    const timeout = (input['timeout'] as number | undefined) ?? 30_000;

    const result = await execaCommand(command, {
      reject: false,
      timeout,
      all: true,
    });

    const output = result.all ?? result.stdout ?? '';
    const exitCode = result.exitCode ?? 0;

    if (exitCode !== 0 && result.stderr) {
      return `Exit ${exitCode}\n${output}\nSTDERR: ${result.stderr}`;
    }

    return output || `(exit ${exitCode})`;
  },
};
