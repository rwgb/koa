import { z } from 'zod';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { readCredentials, writeCredential } from './credentials.js';

const ConfigSchema = z.object({
  model: z.string().default('claude-haiku-4-5-20251001'),
  maxTokens: z.number().default(8192),
  projectPath: z.string(),
  engramEnabled: z.boolean().default(true),
  apiKey: z.string().optional(),
  smartRouting: z.boolean().default(true),
  maxToolOutputChars: z.number().default(12000),
  spiderBrainBrain: z.string().optional(),
  autoCheckpointTurns: z.number().default(5),
  autoCheckpointMinutes: z.number().default(15),
  webToken: z.string().optional(),
  noCache: z.boolean().default(false),
  autoChaining: z.boolean().default(false),
  briefingEnabled: z.boolean().default(false),
  briefingTime: z.string().default('08:00'),
  ttsProvider: z.enum(['say', 'elevenlabs', 'none']).default(os.platform() === 'linux' ? 'none' : 'say'),
  elevenLabsVoiceId: z.string().default('21m00Tcm4TlvDq8ikWAM'),
  elevenLabsModel: z.string().default('eleven_turbo_v2_5'),
  provider: z.enum(['anthropic', 'ollama', 'claude-code', 'auto', 'openai-compatible', 'google']).default('anthropic'),
  ollamaModel: z.string().default('llama3.2'),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  openaiCompatibleBaseUrl: z.string().optional(),
  openaiCompatibleApiKey: z.string().optional(),
  openaiCompatibleModel: z.string().optional(),
  googleApiKey: z.string().optional(),
  googleModel: z.string().optional(),
  claudeCodePath: z.string().default('claude'),
  quotaFallback: z.boolean().default(true),
  sandboxBackend: z.enum(['local', 'docker']).default('local'),
  sandboxTimeoutMs: z.number().default(10000),
  browserEnabled: z.boolean().default(false),
  userName: z.string().default('User'),
  toolTimeoutMs: z.number().optional(),
  publicUrl: z.string().url().optional(),
  // Absolute path to the local home directory used by `koa code` sessions.
  // Defaults to ~/.koa-local/ when KOA_LOCAL_HOME is unset.
  localHome: z.string().optional(),
  mcpServers: z.array(z.object({
    name: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    trusted: z.boolean().optional(),
  })).optional(),
});

export type KoaConfig = z.infer<typeof ConfigSchema>;

function koaDir(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa');
}

// KOA_LOCAL_HOME isolates koa code sessions from the remote server's ~/.koa/.
// Default: ~/.koa-local/  (note: no nested ".koa" — the suffix is already in the dir name)
export function koaLocalDir(): string {
  const base = process.env['KOA_LOCAL_HOME'];
  if (base) return base;
  return path.join(os.homedir(), '.koa-local');
}

/**
 * Ensure the local home directory tree exists without running the interactive
 * setup wizard.  Creates only what is strictly necessary:
 *   <localHome>/
 *   <localHome>/projects/
 *
 * Safe to call on every startup — mkdirSync with { recursive: true } is a no-op
 * when the directories already exist.
 */
export function ensureLocalHome(localHome: string): void {
  fs.mkdirSync(path.join(localHome, 'projects'), { recursive: true, mode: 0o700 });
}

export interface KoaConfigFile {
  model?: string;
  maxTokens?: number;
  smartRouting?: boolean;
  maxToolOutputChars?: number;
  autoCheckpointTurns?: number;
  autoCheckpointMinutes?: number;
  engramEnabled?: boolean;
  noCache?: boolean;
  spiderBrainBrain?: string;
  defaultProjectPath?: string;
  autoChaining?: boolean;
  briefingEnabled?: boolean;
  briefingTime?: string;
  ttsProvider?: 'say' | 'elevenlabs' | 'none';
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
  provider?: 'anthropic' | 'ollama' | 'claude-code' | 'auto' | 'openai-compatible' | 'google';
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  openaiCompatibleBaseUrl?: string;
  openaiCompatibleApiKey?: string;
  openaiCompatibleModel?: string;
  googleApiKey?: string;
  googleModel?: string;
  claudeCodePath?: string;
  quotaFallback?: boolean;
  sandboxBackend?: 'local' | 'docker';
  sandboxTimeoutMs?: number;
  browserEnabled?: boolean;
  userName?: string;
  toolTimeoutMs?: number;
  mcpServers?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    trusted?: boolean;
  }>;
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

  let parsed: KoaConfig;
  try {
    parsed = ConfigSchema.parse({
      model: resolvedModel,
      maxTokens: process.env['KOA_MAX_TOKENS']
        ? parseInt(process.env['KOA_MAX_TOKENS'], 10)
        : (fileConfig.maxTokens ?? 8192),
      projectPath: resolvedPath,
      engramEnabled:
        process.env['KOA_ENGRAM'] !== undefined
          ? process.env['KOA_ENGRAM'] !== 'false'
          : (fileConfig.engramEnabled ?? true),
      apiKey,
      smartRouting:
        process.env['KOA_SMART_ROUTING'] !== undefined
          ? process.env['KOA_SMART_ROUTING'] === 'true'
          : (fileConfig.smartRouting ?? true),
      maxToolOutputChars: process.env['KOA_MAX_TOOL_OUTPUT']
        ? parseInt(process.env['KOA_MAX_TOOL_OUTPUT'], 10)
        : (fileConfig.maxToolOutputChars ?? 12000),
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
      ttsProvider:
        (process.env['KOA_TTS_PROVIDER'] as 'say' | 'elevenlabs' | 'none' | undefined) ??
        fileConfig.ttsProvider ??
        'say',
      elevenLabsVoiceId: fileConfig.elevenLabsVoiceId ?? '21m00Tcm4TlvDq8ikWAM',
      elevenLabsModel: fileConfig.elevenLabsModel ?? 'eleven_turbo_v2_5',
      provider:
        (process.env['KOA_PROVIDER'] as
          | 'anthropic'
          | 'ollama'
          | 'claude-code'
          | 'auto'
          | 'openai-compatible'
          | 'google'
          | undefined) ??
        fileConfig.provider ??
        'anthropic',
      ollamaModel: process.env['KOA_OLLAMA_MODEL'] ?? fileConfig.ollamaModel ?? 'llama3.2',
      ollamaBaseUrl:
        process.env['KOA_OLLAMA_BASE_URL'] ??
        fileConfig.ollamaBaseUrl ??
        'http://localhost:11434',
      openaiCompatibleBaseUrl:
        process.env['KOA_OPENAI_COMPAT_BASE_URL'] ?? fileConfig.openaiCompatibleBaseUrl,
      openaiCompatibleApiKey:
        process.env['KOA_OPENAI_COMPAT_API_KEY'] ?? fileConfig.openaiCompatibleApiKey,
      openaiCompatibleModel:
        process.env['KOA_OPENAI_COMPAT_MODEL'] ?? fileConfig.openaiCompatibleModel ?? 'gpt-4o-mini',
      googleApiKey: process.env['KOA_GOOGLE_API_KEY'] ?? fileConfig.googleApiKey,
      googleModel: process.env['KOA_GOOGLE_MODEL'] ?? fileConfig.googleModel ?? 'gemini-2.0-flash',
      claudeCodePath: (() => {
        const raw = process.env['KOA_CLAUDE_CODE_PATH'] ?? fileConfig.claudeCodePath;
        if (raw !== undefined) validateClaudeCodePath(raw);
        return raw ?? 'claude';
      })(),
      quotaFallback:
        process.env['KOA_QUOTA_FALLBACK'] !== undefined
          ? process.env['KOA_QUOTA_FALLBACK'] !== 'false'
          : (fileConfig.quotaFallback ?? true),
      sandboxBackend:
        (process.env['KOA_SANDBOX_BACKEND'] as 'local' | 'docker' | undefined) ??
        fileConfig.sandboxBackend ??
        'local',
      sandboxTimeoutMs: process.env['KOA_SANDBOX_TIMEOUT_MS']
        ? parseInt(process.env['KOA_SANDBOX_TIMEOUT_MS'], 10)
        : (fileConfig.sandboxTimeoutMs ?? 10000),
      browserEnabled: fileConfig.browserEnabled ?? false,
      userName: process.env['KOA_USER_NAME'] ?? fileConfig.userName ?? 'User',
      toolTimeoutMs: process.env['KOA_TOOL_TIMEOUT_MS']
        ? parseInt(process.env['KOA_TOOL_TIMEOUT_MS'], 10)
        : fileConfig.toolTimeoutMs,
      publicUrl: process.env['KOA_PUBLIC_URL']?.replace(/\/$/, '') ?? undefined,
      localHome: koaLocalDir(),
      mcpServers: fileConfig.mcpServers,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatConfigError(err));
    }
    throw err;
  }
  validateConfig(parsed);
  return parsed;
}

/**
 * Variant of loadConfig used by the `koa code` subcommand.
 *
 * Differences from loadConfig:
 *  - Reads credentials from <localHome>/credentials (not ~/.koa/credentials)
 *  - Reads config.json from <localHome>/config.json  (not ~/.koa/config.json)
 *  - Sets localHome on the returned config so downstream code can store
 *    data (koa.db, memory.db, logs, project memories) under localHome
 *    instead of the shared ~/.koa/ tree.
 *
 * The caller is responsible for calling ensureLocalHome(localHome) before
 * this function so that the directory tree is in place.
 */
export function loadLocalConfig(projectPath?: string): KoaConfig {
  const localHome = koaLocalDir();

  // Read a local config.json if one exists — isolated from the server's config
  let fileConfig: KoaConfigFile = {};
  try {
    const raw = fs.readFileSync(path.join(localHome, 'config.json'), 'utf8');
    fileConfig = JSON.parse(raw) as KoaConfigFile;
  } catch {
    // no local config.json yet — that is normal on first run
  }

  const resolvedPath = projectPath ?? fileConfig.defaultProjectPath ?? process.cwd();

  // Read credentials from the local home, falling back to env vars
  let localCredentials: Record<string, string> = {};
  try {
    const credRaw = fs.readFileSync(path.join(localHome, 'credentials'), 'utf8');
    for (const line of credRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      if (k) localCredentials[k] = v;
    }
  } catch {
    // no local credentials file yet
  }

  const apiKey =
    process.env['ANTHROPIC_API_KEY'] ?? localCredentials['ANTHROPIC_API_KEY'];

  const tierAliases: Record<string, string> = {
    fast: 'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-6',
    powerful: 'claude-opus-4-7',
  };
  const rawModel = process.env['KOA_MODEL'] ?? fileConfig.model ?? 'claude-haiku-4-5-20251001';
  const resolvedModel = tierAliases[rawModel] ?? rawModel;

  let parsed: KoaConfig;
  try {
    parsed = ConfigSchema.parse({
      model: resolvedModel,
      maxTokens: process.env['KOA_MAX_TOKENS']
        ? parseInt(process.env['KOA_MAX_TOKENS'], 10)
        : (fileConfig.maxTokens ?? 8192),
      projectPath: resolvedPath,
      engramEnabled: false,          // local code sessions never use Engram
      apiKey,
      smartRouting: true,
      maxToolOutputChars: process.env['KOA_MAX_TOOL_OUTPUT']
        ? parseInt(process.env['KOA_MAX_TOOL_OUTPUT'], 10)
        : (fileConfig.maxToolOutputChars ?? 12000),
      spiderBrainBrain: undefined,   // no SpiderBrain in local mode
      autoCheckpointTurns: 0,
      autoCheckpointMinutes: 0,
      noCache: process.env['KOA_NO_CACHE'] === 'true' || (fileConfig.noCache ?? false),
      autoChaining: false,
      briefingEnabled: false,
      briefingTime: '08:00',
      ttsProvider: 'none',
      elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
      elevenLabsModel: 'eleven_turbo_v2_5',
      provider:
        (process.env['KOA_PROVIDER'] as
          | 'anthropic'
          | 'ollama'
          | 'claude-code'
          | 'auto'
          | 'openai-compatible'
          | 'google'
          | undefined) ??
        fileConfig.provider ??
        'anthropic',
      ollamaModel: process.env['KOA_OLLAMA_MODEL'] ?? fileConfig.ollamaModel ?? 'llama3.2',
      ollamaBaseUrl:
        process.env['KOA_OLLAMA_BASE_URL'] ??
        fileConfig.ollamaBaseUrl ??
        'http://localhost:11434',
      openaiCompatibleBaseUrl:
        process.env['KOA_OPENAI_COMPAT_BASE_URL'] ?? fileConfig.openaiCompatibleBaseUrl,
      openaiCompatibleApiKey:
        process.env['KOA_OPENAI_COMPAT_API_KEY'] ?? fileConfig.openaiCompatibleApiKey,
      openaiCompatibleModel:
        process.env['KOA_OPENAI_COMPAT_MODEL'] ?? fileConfig.openaiCompatibleModel ?? 'gpt-4o-mini',
      googleApiKey: process.env['KOA_GOOGLE_API_KEY'] ?? fileConfig.googleApiKey,
      googleModel: process.env['KOA_GOOGLE_MODEL'] ?? fileConfig.googleModel ?? 'gemini-2.0-flash',
      claudeCodePath: (() => {
        const raw = process.env['KOA_CLAUDE_CODE_PATH'] ?? fileConfig.claudeCodePath;
        if (raw !== undefined) validateClaudeCodePath(raw);
        return raw ?? 'claude';
      })(),
      quotaFallback:
        process.env['KOA_QUOTA_FALLBACK'] !== undefined
          ? process.env['KOA_QUOTA_FALLBACK'] !== 'false'
          : (fileConfig.quotaFallback ?? true),
      sandboxBackend:
        (process.env['KOA_SANDBOX_BACKEND'] as 'local' | 'docker' | undefined) ??
        fileConfig.sandboxBackend ??
        'local',
      sandboxTimeoutMs: process.env['KOA_SANDBOX_TIMEOUT_MS']
        ? parseInt(process.env['KOA_SANDBOX_TIMEOUT_MS'], 10)
        : (fileConfig.sandboxTimeoutMs ?? 10000),
      browserEnabled: false,
      userName: process.env['KOA_USER_NAME'] ?? fileConfig.userName ?? 'User',
      toolTimeoutMs: process.env['KOA_TOOL_TIMEOUT_MS']
        ? parseInt(process.env['KOA_TOOL_TIMEOUT_MS'], 10)
        : fileConfig.toolTimeoutMs,
      publicUrl: undefined,
      localHome,
      mcpServers: fileConfig.mcpServers,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new Error(formatConfigError(err));
    }
    throw err;
  }
  // Skip API key check here — the `koa code` subcommand checks apiKey itself and
  // emits a message that points at the local credentials path, not ~/.koa/credentials.
  validateConfig(parsed, { skipApiKeyCheck: true });
  return parsed;
}

// Maps internal config field names to the env var users actually set, so error
// messages point at KOA_* knobs instead of opaque schema paths.
const FIELD_TO_ENV: Record<string, string> = {
  maxTokens: 'KOA_MAX_TOKENS',
  maxToolOutputChars: 'KOA_MAX_TOOL_OUTPUT',
  autoCheckpointTurns: 'KOA_CHECKPOINT_TURNS',
  autoCheckpointMinutes: 'KOA_CHECKPOINT_MINUTES',
  sandboxTimeoutMs: 'KOA_SANDBOX_TIMEOUT_MS',
  model: 'KOA_MODEL',
  provider: 'KOA_PROVIDER',
};

function formatConfigError(err: z.ZodError): string {
  const lines = err.issues.map((issue) => {
    const field = String(issue.path[0] ?? '(root)');
    const envName = FIELD_TO_ENV[field];
    const where = envName ? `${envName} (config field "${field}")` : `config field "${field}"`;
    return `  - ${where}: ${issue.message}`;
  });
  return (
    `Invalid Koa configuration:\n${lines.join('\n')}\n` +
    `Check your environment variables and ~/.koa/config.json.`
  );
}

// Validates that a claude binary path is safe to pass to spawn():
//   1. Must be absolute (starts with /)
//   2. Basename must start with "claude" — blocks /usr/bin/rm etc.
//   3. Must not contain shell metacharacters that could cause injection
export function validateClaudeCodePath(p: string): void {
  const shellMeta = /[;|&`$\n\r\0]/;
  if (!path.isAbsolute(p)) {
    throw new Error(
      'KOA_CLAUDE_CODE_PATH must be an absolute path to a claude binary (e.g. /usr/local/bin/claude)',
    );
  }
  if (!/^claude/.test(path.basename(p))) {
    throw new Error(
      'KOA_CLAUDE_CODE_PATH must be an absolute path to a claude binary (e.g. /usr/local/bin/claude)',
    );
  }
  if (shellMeta.test(p)) {
    throw new Error(
      'KOA_CLAUDE_CODE_PATH must be an absolute path to a claude binary (e.g. /usr/local/bin/claude)',
    );
  }
}

// Enforces provider<->credential coherence that the schema can't express, with
// one-line actionable errors instead of a mid-turn provider failure.
//
// skipApiKeyCheck: set to true in loadLocalConfig so the `koa code` subcommand
// can emit its own error message that points at the local credentials file path
// rather than the shared ~/.koa/credentials path.
export function validateConfig(config: KoaConfig, { skipApiKeyCheck = false } = {}): void {
  const errors: string[] = [];

  if (!skipApiKeyCheck && config.provider === 'anthropic' && !config.apiKey) {
    errors.push(
      'provider is "anthropic" but no API key is set. ' +
        'Run `koa config set api-key <key>` or set ANTHROPIC_API_KEY.',
    );
  }
  if (!skipApiKeyCheck && config.provider === 'auto' && !config.apiKey) {
    errors.push(
      'provider is "auto" but no Anthropic API key is set; auto cannot fall back to ' +
        'Anthropic. Set ANTHROPIC_API_KEY or choose provider "ollama"/"claude-code".',
    );
  }
  if (config.provider === 'openai-compatible' && !config.openaiCompatibleBaseUrl) {
    errors.push(
      'provider is "openai-compatible" but openaiCompatibleBaseUrl is not set. Set KOA_OPENAI_COMPAT_BASE_URL.',
    );
  }
  if (config.provider === 'google' && !config.googleApiKey) {
    errors.push('provider is "google" but googleApiKey is not set. Set KOA_GOOGLE_API_KEY.');
  }
  if (!Number.isFinite(config.maxTokens) || config.maxTokens <= 0) {
    errors.push(`KOA_MAX_TOKENS must be a positive number (got ${config.maxTokens}).`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid Koa configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}

export function getEngramBrainPath(projectPath: string): string {
  // Matches Engram's Python slug: Path(project_path).name.lower().replace(" ", "-")
  const slug = path.basename(projectPath).toLowerCase().replace(/\s+/g, '-');
  return path.join(os.homedir(), '.engram', 'brains', slug, 'brain.db');
}

export const ENGRAM_CLI = path.join(os.homedir(), '.claude', 'skills', 'engram', 'cli', 'engram.py');

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
