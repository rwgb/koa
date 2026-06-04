import fs from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';

const ToolManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, 'name must match /^[a-z][a-z0-9_]{1,49}$/'),
  description: z.string(),
  inputSchema: z.record(z.unknown()).optional(),
  transport: z.enum(['bash', 'http', 'mcp']),
  config: z.record(z.string()),
});

const PluginDefSchema = z.object({
  name: z.string(),
  version: z.string().optional().default('0.0.0'),
  description: z.string().optional().default(''),
  tools: z.array(ToolManifestSchema),
});

export type ToolManifest = z.infer<typeof ToolManifestSchema>;
export type PluginDef = z.infer<typeof PluginDefSchema> & { sourcePath: string };

function pluginsDir(): string {
  // KOA_HOME overrides the base directory (used in tests to point at a tmp dir).
  // In production the plugins live at ~/.koa/plugins.
  const base = process.env['KOA_HOME'];
  return base
    ? path.join(base, 'plugins')
    : path.join(os.homedir(), '.koa', 'plugins');
}

export function loadPlugins(): PluginDef[] {
  const dir = pluginsDir();
  if (!fs.existsSync(dir)) return [];
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  } catch {
    return [];
  }
  const results: PluginDef[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(raw) as unknown;
      const parsed = PluginDefSchema.parse(json);
      results.push({ ...parsed, sourcePath: filePath });
    } catch (err) {
      console.warn(`[plugins] Skipping ${file}: ${(err as Error).message}`);
    }
  }
  return results;
}
