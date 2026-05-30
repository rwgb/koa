import { z } from 'zod';
import path from 'path';
import os from 'os';

const ConfigSchema = z.object({
  model: z.string().default('claude-sonnet-4-6'),
  maxTokens: z.number().default(8096),
  projectPath: z.string(),
  engramEnabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  smartRouting: z.boolean().default(false),
  maxToolOutputChars: z.number().default(12000),
  compactAfterTurns: z.number().default(10),
});

export type KoaConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(projectPath?: string): KoaConfig {
  const resolvedPath = projectPath ?? process.cwd();

  return ConfigSchema.parse({
    model: process.env['KOA_MODEL'] ?? 'claude-sonnet-4-6',
    maxTokens: process.env['KOA_MAX_TOKENS'] ? parseInt(process.env['KOA_MAX_TOKENS'], 10) : 8096,
    projectPath: resolvedPath,
    engramEnabled: process.env['KOA_ENGRAM'] !== 'false',
    apiKey: process.env['ANTHROPIC_API_KEY'],
    smartRouting: process.env['KOA_SMART_ROUTING'] === 'true',
    maxToolOutputChars: process.env['KOA_MAX_TOOL_OUTPUT']
      ? parseInt(process.env['KOA_MAX_TOOL_OUTPUT'], 10)
      : 12000,
    compactAfterTurns: process.env['KOA_COMPACT_TURNS']
      ? parseInt(process.env['KOA_COMPACT_TURNS'], 10)
      : 10,
  });
}

export function getEngramBrainPath(projectPath: string): string {
  const slug = projectPath.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return path.join(os.homedir(), '.engram', 'brains', slug, 'brain.db');
}

export const ENGRAM_CLI = path.join(os.homedir(), '.claude', 'skills', 'engram', 'cli', 'engram.py');
