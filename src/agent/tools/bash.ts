import { execa } from 'execa';
import type { Tool, ToolInput } from '../../types/index.js';

const projectRoot = process.cwd();

const BLOCKED_PATTERNS = [
  /curl\s.*|s*(ba)?sh/,
  /wget\s.*|s*(ba)?sh/,
  /nc\s+-e/,
  /\/dev\/tcp\//,
  /bash\s+-i/,
  /python[23]?\s+-c\s.*socket/,
];

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
    const MAX_TIMEOUT = 300_000; // 5 minutes hard ceiling
    const rawTimeout = (input['timeout'] as number | undefined) ?? 30_000;
    const timeout = Math.min(Math.max(rawTimeout, 1_000), MAX_TIMEOUT);

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error('Command blocked by security policy');
      }
    }

    process.stderr.write('[koa/bash-audit] exec: ' + command.slice(0, 200) + '\n');

    const result = await execa('bash', ['-c', command], {
      reject: false,
      timeout,
      all: true,
      cwd: projectRoot,
    });

    const output = result.all ?? result.stdout ?? '';
    const exitCode = result.exitCode ?? 0;

    if (exitCode !== 0 && result.stderr) {
      return `Exit ${exitCode}\n${output}\nSTDERR: ${result.stderr}`;
    }

    return output || `(exit ${exitCode})`;
  },
};
