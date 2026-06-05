import { spawn } from 'child_process';
import type { Tool } from '../../types/index.js';
import type { CustomSkillDef } from '../../skills/store.js';
import { validateSafeUrl } from '../../utils/ssrf.js';

function splitArgs(cmd: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of cmd) {
    if (ch === '"' || ch === "'") {
      if (inQuote === ch) inQuote = null;
      else if (!inQuote) inQuote = ch;
      else current += ch;
    } else if (ch === ' ' && !inQuote) {
      if (current) { args.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) args.push(current);
  return args;
}

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
        const [bin, ...spawnArgs] = splitArgs(command);
        if (!bin) return 'Error: empty command';
        return new Promise((resolve) => {
          const child = spawn(bin, spawnArgs, { timeout: 30_000 });
          let stdout = '';
          let stderr = '';
          child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
          child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
          child.on('close', (code) => {
            if (code !== 0) resolve(`Error: exit ${code}\n${stderr}`.trim());
            else resolve(stdout || stderr || '(no output)');
          });
          child.on('error', (err) => resolve(`Error: ${err.message}`));
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
        try { validateSafeUrl(url); } catch (err) { return `Error: ${(err as Error).message}`; }
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
