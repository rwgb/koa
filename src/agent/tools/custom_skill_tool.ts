import { exec } from 'child_process';
import type { Tool } from '../../types/index.js';
import type { CustomSkillDef } from '../../skills/store.js';

export function createCustomSkillTool(skill: CustomSkillDef): Tool {
  if (skill.type === 'bash') {
    return {
      name: skill.name,
      description: skill.description,
      inputSchema: {
        type: 'object' as const,
        properties: {
          input: {
            type: 'object',
            description: 'Key-value pairs substituted into the command template as {{input.key}}',
            additionalProperties: { type: 'string' },
          },
        },
        required: [],
      },
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const input = (args['input'] as Record<string, string>) ?? {};
        const command = (skill.config['command'] ?? '').replace(
          /\{\{input\.(\w+)\}\}/g,
          (_, k: string) => input[k] ?? '',
        );
        if (!command.trim()) return 'Error: command template is empty';
        return new Promise((resolve) => {
          exec(command, { timeout: 30_000 }, (err, stdout, stderr) => {
            if (err) resolve(`Error: ${err.message}\n${stderr}`.trim());
            else resolve(stdout || stderr || '(no output)');
          });
        });
      },
    };
  }

  if (skill.type === 'http') {
    return {
      name: skill.name,
      description: skill.description,
      inputSchema: {
        type: 'object' as const,
        properties: {
          body: { type: 'string', description: 'Request body (JSON string or plain text)' },
        },
        required: [],
      },
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const url = skill.config['url'];
        const method = (skill.config['method'] ?? 'GET').toUpperCase();
        if (!url) return 'Error: URL not configured for this skill';
        const opts: RequestInit = { method };
        if (args['body'] && method !== 'GET') {
          opts.body = args['body'] as string;
          opts.headers = { 'Content-Type': 'application/json' };
        }
        try {
          const r = await fetch(url, opts);
          const text = await r.text();
          return `HTTP ${r.status}\n${text}`;
        } catch (err) {
          return `Error: ${(err as Error).message}`;
        }
      },
    };
  }

  // mcp type — requires a running MCP server; not yet proxied
  return {
    name: skill.name,
    description: `${skill.description} (MCP proxy — not yet supported)`,
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
    execute: async (): Promise<string> =>
      `MCP proxy for "${skill.name}" is not yet supported. Configure the MCP server directly via the mcp command.`,
  };
}
