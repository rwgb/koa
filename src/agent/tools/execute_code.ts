import type { Tool, ToolInput } from '../../types/index.js';
import type { SandboxRunner } from '../../sandbox/runner.js';
import type { KoaConfig } from '../../config/index.js';
import { UnsupportedLanguageError } from '../../sandbox/local.js';

const SUPPORTED_LANGUAGES = ['javascript', 'python', 'bash'] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang);
}

export function createExecuteCodeTool(runner: SandboxRunner, config: KoaConfig): Tool {
  return {
    name: 'execute_code',
    description:
      'Run a code snippet locally on this machine and return stdout, stderr, and exit code. ' +
      'Supported languages: javascript, python, bash. ' +
      'WARNING: This executes code directly on the host — only call this tool with code ' +
      'that the user has explicitly provided or approved.',
    inputSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'python', 'bash'],
          description: 'Programming language of the code snippet',
        },
        code: {
          type: 'string',
          description: 'The code to execute',
        },
      },
      required: ['language', 'code'],
    },
    async execute(input: ToolInput): Promise<string> {
      const language = input['language'] as string;
      const code = input['code'] as string;

      if (!code || !code.trim()) {
        return 'Error: code must not be blank';
      }

      if (!isSupportedLanguage(language)) {
        return `Error: unsupported language "${language}". Supported: ${SUPPORTED_LANGUAGES.join(', ')}`;
      }

      let result;
      try {
        result = await runner.exec(code, language, {
          timeoutMs: config.sandboxTimeoutMs,
        });
      } catch (err) {
        if (err instanceof UnsupportedLanguageError) {
          return `Error: ${err.message}`;
        }
        throw err;
      }

      const lines: string[] = [
        `exit_code: ${result.exitCode}`,
        `timed_out: ${result.timedOut}`,
      ];

      if (result.stdout) {
        lines.push('', '--- stdout ---', result.stdout);
      }
      if (result.stderr) {
        lines.push('', '--- stderr ---', result.stderr);
      }
      if (!result.stdout && !result.stderr) {
        lines.push('', '(no output)');
      }

      return lines.join('\n');
    },
  };
}
