import { spawn } from 'child_process';
import type { Tool } from '../../types/index.js';
import type { CustomSkillDef } from '../../skills/store.js';
import { validateSafeUrl } from '../../utils/ssrf.js';

const HTTP_MAX_BYTES = 50_000;
const HTTP_TIMEOUT_MS = 20_000;

/**
 * Parse a bash-style command template into an argv array.
 * Handles quoted strings — does NOT perform shell glob expansion or variable substitution.
 */
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

/**
 * Build argv from a command template with safe argument substitution.
 *
 * Template syntax:
 *   {{input.key}}       — value substituted as a standalone argument; must not start with '-'
 *   {{flag:input.key}}  — value substituted as a standalone argument; may start with '-'
 *
 * Rules:
 *   - A placeholder token must be the entire argv element (not embedded in a larger token).
 *   - Regular placeholder values starting with '-' are rejected (flag-injection guard).
 * Returns an Error string if validation fails; otherwise returns string[].
 */
function buildArgv(
  command: string,
  input: Record<string, string>,
): string[] | string {
  // Tokenise with a placeholder-aware splitter so each placeholder becomes one token.
  // We replace placeholders with a sentinel before splitting, then restore them.
  const SENTINEL_PREFIX = '\x00PH\x00';
  const placeholders: string[] = [];

  const withSentinels = command.replace(
    /\{\{(flag:)?input\.(\w+)\}\}/g,
    (_full, flag: string | undefined, key: string) => {
      const value = input[key] ?? '';
      const isFlag = Boolean(flag);
      const idx = placeholders.length;
      placeholders.push(JSON.stringify({ value, isFlag }));
      return `${SENTINEL_PREFIX}${idx}${SENTINEL_PREFIX}`;
    },
  );

  // Verify no placeholder remnants are embedded mid-token
  const rawTokens = splitArgs(withSentinels);
  const argv: string[] = [];

  for (const token of rawTokens) {
    // Detect mid-token embedding: token has sentinel but isn't purely a sentinel
    const sentinelRe = new RegExp(`${SENTINEL_PREFIX}(\\d+)${SENTINEL_PREFIX}`, 'g');
    const sentinelMatches = [...token.matchAll(sentinelRe)];

    if (sentinelMatches.length === 0) {
      // No placeholder — plain literal token
      argv.push(token);
      continue;
    }

    if (sentinelMatches.length === 1) {
      const match = sentinelMatches[0]!;
      // Check if the sentinel is the entire token (after stripping the sentinel markers)
      const sentinelFull = match[0]!;
      if (token !== sentinelFull) {
        // Placeholder is embedded inside a larger token like --arg={{input.val}}
        return 'Error: placeholder must be a standalone argument — embedding {{input.key}} mid-token is not allowed';
      }
      const ph = JSON.parse(placeholders[Number(match[1]!)]!) as { value: string; isFlag: boolean };
      if (!ph.isFlag && ph.value.startsWith('-')) {
        return `Error: argument value "${ph.value}" may not start with "-" — use {{flag:input.key}} to pass flag values`;
      }
      argv.push(ph.value);
      continue;
    }

    // Multiple sentinels in one token — mid-token embedding
    return 'Error: placeholder must be a standalone argument — embedding {{input.key}} mid-token is not allowed';
  }

  return argv;
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
        const command = skill.config['command'] ?? '';
        if (!command.trim()) return 'Error: command template is empty';

        const argvOrError = buildArgv(command, input);
        if (typeof argvOrError === 'string') return argvOrError;

        const [bin, ...spawnArgs] = argvOrError;
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
        try { await validateSafeUrl(url); } catch (err) { return `Error: ${(err as Error).message}`; }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

        const opts: RequestInit = { method, signal: controller.signal };
        if (args['body'] && method !== 'GET') {
          opts.body = args['body'] as string;
          opts.headers = { 'Content-Type': 'application/json' };
        }

        try {
          const r = await fetch(url, opts);

          // Stream body with byte cap
          const reader = r.body?.getReader();
          if (!reader) {
            clearTimeout(timer);
            return `HTTP ${r.status}\n`;
          }

          const chunks: Uint8Array[] = [];
          let totalBytes = 0;
          try {
            while (totalBytes < HTTP_MAX_BYTES) {
              const { done, value } = await reader.read();
              if (done || !value) break;
              chunks.push(value);
              totalBytes += value.byteLength;
            }
          } finally {
            reader.cancel();
          }
          clearTimeout(timer);

          const decoder = new TextDecoder();
          const combined = chunks.reduce((acc, chunk) => acc + decoder.decode(chunk, { stream: true }), '');
          const body = combined.slice(0, HTTP_MAX_BYTES);
          return `HTTP ${r.status}\n${body}`;
        } catch (err) {
          clearTimeout(timer);
          if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
            return `Error: request timed out after ${HTTP_TIMEOUT_MS / 1000}s`;
          }
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
