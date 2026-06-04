import { exec } from 'child_process';
import type { Tool } from '../types/index.js';
import type { ToolManifest } from './loader.js';

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
        const command = (manifest.config['command'] ?? '').replace(
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
