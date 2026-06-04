import { z } from 'zod';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { readCredentials, writeCredential } from './credentials.js';

const ConfigSchema = z.object({
  model: z.string().default('claude-haiku-4-5-20251001'),
  maxTokens: z.number().default(8096),
  projectPath: z.string(),
  engramEnabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  smartRouting: z.boolean().default(false),
  maxToolOutputChars: z.number().default(12000),
  compactAfterTurns: z.number().default(10),
  spiderBrainBrain: z.string().optional(),
  autoCheckpointTurns: z.number().default(5),
  autoCheckpointMinutes: z.number().default(15),
  webToken: z.string().optional(),
  noCache: z.boolean().default(false),
  autoChaining: z.boolean().default(false),
  briefingEnabled: z.boolean().default(false),
  briefingTime: z.string().default('08:00'),
  ttsProvider: z.enum(['say', 'elevenlabs']).default('say'),
  elevenLabsVoiceId: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  elevenLabsModel: z.string().default('eleven_turbo_v2_5'),
  provider: z.enum(['anthropic', 'ollama']).default('anthropic'),
  ollamaModel: z.string().default('llama3.2'),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  sandboxBackend: z.enum(['local', 'docker']).default('local'),
  sandboxTimeoutMs: z.number().default(10000),
});

export type KoaConfig = z.infer<typeof ConfigSchema>;

function koaDir(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa');
}

export interface KoaConfigFile {
  model?: string;
  maxTokens?: number;
  smartRouting?: boolean;
  maxToolOutputChars?: number;
  compactAfterTurns?: number;
  autoCheckpointTurns?: number;
  autoCheckpointMinutes?: number;
  engramEnabled?: boolean;
  noCache?: boolean;
  spiderBrainBrain?: string;
  defaultProjectPath?: string;
  autoChaining?: boolean;
  briefingEnabled?: boolean;
  briefingTime?: string;
  ttsProvider?: 'say' | 'elevenlabs';
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
  provider?: 'anthropic' | 'ollama';
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  sandboxBackend?: 'local' | 'docker';
  sandboxTimeoutMs?: number;
}

export function readKoaConfigFile(): KoaConfigFile {
  try {
    const raw = fs.readFileSync(path.join(koaDir(), 'config.json'), 'utf8');
    return JSON.parse(raw) as KoaConfigFile;
  } catch {
    return {};
  }
}

export function writeKoaConfigFile(updates: KoaConfigFile): void {
  const dir = koaDir();
  fs.mkdirSync(dir, { recursive: true });
  const existing = readKoaConfigFile();
  const merged = { ...existing, ...updates };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(merged, null, 2), { mode: 0o600 });
}

export function loadConfig(projectPath?: string): KoaConfig {
  const fileConfig = readKoaConfigFile();
  const resolvedPath = projectPath ?? fileConfig.defaultProjectPath ?? process.cwd();
  // Env var takes precedence; credentials file is the persistent fallback.
  const credentials = readCredentials();
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? credentials['ANTHROPIC_API_KEY'];
  const webToken = process.env['KOA_WEB_TOKEN'] ?? credentials['KOA_WEB_TOKEN'];

  const tierAliases: Record<string, string> = {
    fast: 'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-6',
    powerful: 'claude-opus-4-7',
  };
  const rawModel = process.env['KOA_MODEL'] ?? fileConfig.model ?? 'claude-haiku-4-5-20251001';
  const resolvedModel = tierAliases[rawModel] ?? rawModel;

  return ConfigSchema.parse({
    model: resolvedModel,
    maxTokens: process.env['KOA_MAX_TOKENS']
      ? parseInt(process.env['KOA_MAX_TOKENS'], 10)
      : (fileConfig.maxTokens ?? 8096),
    projectPath: resolvedPath,
    engramEnabled: process.env['KOA_ENGRAM'] !== undefined
      ? process.env['KOA_ENGRAM'] !== 'false'
      : (fileConfig.engramEnabled ?? true),
    apiKey,
    smartRouting: process.env['KOA_SMART_ROUTING'] !== undefined
      ? process.env['KOA_SMART_ROUTING'] === 'true'
      : (fileConfig.smartRouting ?? false),
    maxToolOutputChars: process.env['KOA_MAX_TOOL_OUTPUT']
      ? parseInt(process.env['KOA_MAX_TOOL_OUTPUT'], 10)
      : (fileConfig.maxToolOutputChars ?? 12000),
    compactAfterTurns: process.env['KOA_COMPACT_TURNS']
      ? parseInt(process.env['KOA_COMPACT_TURNS'], 10)
      : (fileConfig.compactAfterTurns ?? 10),
    spiderBrainBrain: process.env['SPIDERBRAIN_BRAIN'] ?? fileConfig.spiderBrainBrain,
    autoCheckpointTurns: process.env['KOA_CHECKPOINT_TURNS']
      ? parseInt(process.env['KOA_CHECKPOINT_TURNS'], 10)
      : (fileConfig.autoCheckpointTurns ?? 5),
    autoCheckpointMinutes: process.env['KOA_CHECKPOINT_MINUTES']
      ? parseInt(process.env['KOA_CHECKPOINT_MINUTES'], 10)
      : (fileConfig.autoCheckpointMinutes ?? 15),
    webToken,
    noCache: process.env['KOA_NO_CACHE'] === 'true' || (fileConfig.noCache ?? false),
    autoChaining: fileConfig.autoChaining ?? false,
    briefingEnabled: fileConfig.briefingEnabled ?? false,
    briefingTime: fileConfig.briefingTime ?? '08:00',
    ttsProvider: (process.env['KOA_TTS_PROVIDER'] as 'say' | 'elevenlabs' | undefined) ?? fileConfig.ttsProvider ?? 'say',
    elevenLabsVoiceId: fileConfig.elevenLabsVoiceId ?? '21m00Tcm4TlvDq8ikWAM',
    elevenLabsModel: fileConfig.elevenLabsModel ?? 'eleven_turbo_v2_5',
    provider: (process.env['KOA_PROVIDER'] as 'anthropic' | 'ollama' | undefined) ?? fileConfig.provider ?? 'anthropic',
    ollamaModel: process.env['KOA_OLLAMA_MODEL'] ?? fileConfig.ollamaModel ?? 'llama3.2',
    ollamaBaseUrl: process.env['KOA_OLLAMA_BASE_URL'] ?? fileConfig.ollamaBaseUrl ?? 'http://localhost:11434',
    sandboxBackend: (process.env['KOA_SANDBOX_BACKEND'] as 'local' | 'docker' | undefined) ?? fileConfig.sandboxBackend ?? 'local',
    sandboxTimeoutMs: process.env['KOA_SANDBOX_TIMEOUT_MS']
      ? parseInt(process.env['KOA_SANDBOX_TIMEOUT_MS'], 10)
      : (fileConfig.sandboxTimeoutMs ?? 10000),
  });
}

export function getEngramBrainPath(projectPath: string): string {
  // Matches Engram's Python slug: Path(project_path).name.lower().replace(" ", "-")
  const slug = path.basename(projectPath).toLowerCase().replace(/\s+/g, '-');
  return path.join(os.homedir(), '.engram', 'brains', slug, 'brain.db');
}

export const ENGRAM_CLI = path.join(os.homedir(), '.claude', 'skills', 'engram', 'cli', 'engram.py');

// Haiku is used for all background LLM generation (journal, STATE.md, PROJECT.md, dispatch_agent)
// to minimize cost. Kept as a single constant so a model version bump is a one-line change.
export const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

// Maximum ms to wait for the Haiku pre-classifier before falling back to 'moderate'.
export const HAIKU_CLASSIFIER_TIMEOUT_MS = 3000;

export function generateWebToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function setWebToken(token: string): void {
  writeCredential('KOA_WEB_TOKEN', token);
}

export function setApiKey(key: string): void {
  writeCredential('ANTHROPIC_API_KEY', key);
}
