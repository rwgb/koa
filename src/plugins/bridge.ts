import { spawn } from 'child_process';
import type { Tool } from '../types/index.js';
import type { ToolManifest } from './loader.js';
import { validateSafeUrl } from '../utils/ssrf.js';

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

export function createPluginTool(manifest: ToolManifest): Tool {
  const inputSchema = (manifest.inputSchema as Tool['inputSchema']) ?? {
    type: 'object' as const,
    properties: {},
    required: [],
  };

  if (manifest.transport === 'bash') {
    return {
      name: manifest.name,
      description: manifest.description,
      inputSchema,
      source: 'plugin',
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const input = (args['input'] as Record<string, string>) ?? {};
        // Split the template first, then substitute per-arg so user-supplied values
        // cannot inject new argv tokens (a value with spaces stays one arg).
        const templateArgs = splitArgs(manifest.config['command'] ?? '');
        if (!templateArgs.length) return 'Error: command template is empty';
        const [bin, ...spawnArgs] = templateArgs.map(arg =>
          arg.replace(/\{\{input\.(\w+)\}\}/g, (_, k: string) => input[k] ?? ''),
        );
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

  if (manifest.transport === 'http') {
    return {
      name: manifest.name,
      description: manifest.description,
      inputSchema,
      source: 'plugin',
      execute: async (args: Record<string, unknown>): Promise<string> => {
        const url = manifest.config['url'];
        const method = (manifest.config['method'] ?? 'GET').toUpperCase();
        if (!url) return 'Error: URL not configured for this plugin tool';
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

  return {
    name: manifest.name,
    description: `${manifest.description} (MCP proxy — not yet supported)`,
    inputSchema,
    source: 'plugin',
    execute: async (): Promise<string> =>
      `MCP proxy for "${manifest.name}" is not yet supported. Configure the MCP server directly via the mcp command.`,
  };
}
