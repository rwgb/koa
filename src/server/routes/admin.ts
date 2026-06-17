import { Router } from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { AgentLoop } from '../../agent/loop.js';
import type { KoaConfig } from '../../config/index.js';
import { readKoaConfigFile, writeKoaConfigFile, setApiKey } from '../../config/index.js';
import { readCredentials, writeCredential, deleteCredential } from '../../config/credentials.js';
import { projectMemoryPaths } from '../../project-memory/paths.js';
import { readMarkdownFile, writeMarkdownFile } from '../../project-memory/store.js';
import { loadMemories, addMemory, removeMemory } from '../../memory/store.js';
import { validateSafeUrl } from '../../utils/ssrf.js';
import { isOllamaUrl } from '../../utils/ollama_url.js';
import {
  loadIntegrations,
  saveIntegration,
  deleteIntegration,
  maskSecrets,
  mergeConfig,
  ALLOWED_TYPES,
} from '../../integrations/store.js';
import {
  loadRules,
  saveRules,
  loadQuietHours,
  saveQuietHours,
  loadEscalationSettings,
  saveEscalationSettings,
} from '../../notifications/store.js';
import { escalationScheduler } from '../../notifications/escalation.js';
import {
  loadCustomSkills,
  saveCustomSkill,
  deleteCustomSkill,
} from '../../skills/store.js';
import { loadPlugins } from '../../plugins/loader.js';
import { generateOAuthUrl, exchangeCodeForTokens, gmailPoller } from '../../channels/gmail.js';
import { generateCalendarOAuthUrl, exchangeCalendarCode } from '../../calendar/oauth.js';
import { calendarSync } from '../../calendar/sync.js';
import { TelegramPoller } from '../../channels/telegram.js';
import { setTelegramPoller } from '../../channels/router.js';
import { DockerRunner } from '../../sandbox/docker.js';
import { isBrowserAvailable } from '../../browser/client.js';
import { spawn } from 'child_process';
import {
  createDelegation,
  listDelegations,
  getDelegation,
  updateDelegation,
  deleteDelegation,
} from '../../db/index.js';
import type { Delegation } from '../../db/index.js';
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Map from nonce (64-char hex) → creation timestamp (ms since epoch).
// Nonces are consumed on first use (CSRF protection for OAuth callbacks).
export type OAuthStateMap = Map<string, number>;

export interface AdminRouterDeps {
  loop: AgentLoop;
  config: KoaConfig;
  getTelegramPoller: () => TelegramPoller | null;
  setTelegramPollerRef: (p: TelegramPoller | null) => void;
  oauthState: OAuthStateMap;
}

/**
 * Standalone router for OAuth callback endpoints.
 * Must be mounted BEFORE requireAuth so Google can redirect back without a bearer token.
 */
export function createOAuthCallbackRouter(
  config: KoaConfig,
  oauthState: OAuthStateMap,
): Router {
  const router = Router();

  router.get('/oauth/gmail/callback', (req, res) => {
    const { code, error, state } = req.query as { code?: string; error?: string; state?: string };
    if (error || !code) {
      res.redirect(`/integrations?error=oauth_failed`);
      return;
    }
    // Validate CSRF nonce
    if (!state || !oauthState.has(state)) {
      res.redirect(`/integrations?error=oauth_failed`);
      return;
    }
    // Consume the nonce (one-time use)
    oauthState.delete(state);

    const redirectUri = `${req.protocol}://${req.get('host')}/api/admin/oauth/gmail/callback`;
    exchangeCodeForTokens(code, redirectUri)
      .then(tokens => {
        const integrations = loadIntegrations();
        const existing = integrations.find(i => i.type === 'gmail');
        saveIntegration({
          id: existing?.id ?? 'gmail',
          type: 'gmail',
          name: 'Gmail',
          status: 'connected',
          config: {
            ...(existing?.config ?? {}),
            refreshToken: tokens.refresh_token,
            scopes: tokens.scope,
          },
        });
        if (config.apiKey) gmailPoller.start(config.apiKey);
        res.redirect('/integrations?connected=gmail');
      })
      .catch(e => {
        console.error('[oauth/gmail/callback]', e);
        res.redirect(`/integrations?error=oauth_failed`);
      });
  });

  router.get('/oauth/calendar/callback', (req, res) => {
    const { code, error, state } = req.query as { code?: string; error?: string; state?: string };
    if (error || !code) {
      res.redirect(`/integrations?error=oauth_failed`);
      return;
    }
    // Validate CSRF nonce (calendar uses the same oauthState map)
    if (!state || !oauthState.has(state)) {
      res.redirect(`/integrations?error=oauth_failed`);
      return;
    }
    oauthState.delete(state);

    const redirectUri = `${req.protocol}://${req.get('host')}/api/admin/oauth/calendar/callback`;
    exchangeCalendarCode(code, redirectUri)
      .then(tokens => {
        const integrations = loadIntegrations();
        const existing = integrations.find(i => i.type === 'google-calendar');
        saveIntegration({
          id: existing?.id ?? 'google-calendar',
          type: 'google-calendar',
          name: 'Google Calendar',
          status: 'connected',
          config: {
            ...(existing?.config ?? {}),
            refreshToken: tokens.refresh_token,
          },
        });
        calendarSync.start();
        void calendarSync.syncNow();
        res.redirect('/integrations?connected=google-calendar');
      })
      .catch(e => {
        console.error('[oauth/calendar/callback]', e);
        res.redirect(`/integrations?error=oauth_failed`);
      });
  });

  return router;
}

const PM_FILES = ['PROJECT', 'STATE', 'BACKLOG', 'HANDOFF'] as const;
type PmFile = (typeof PM_FILES)[number];
const PM_KEY_MAP: Record<PmFile, keyof ReturnType<typeof projectMemoryPaths>> = {
  PROJECT: 'projectMd',
  STATE: 'stateMd',
  BACKLOG: 'backlogMd',
  HANDOFF: 'handoffMd',
};

interface MarketplaceEntry {
  name: string;
  description: string;
  icon: string;
  requires: string[];
}

const MARKETPLACE: MarketplaceEntry[] = [
  { name: 'github_pr_review', description: 'Review GitHub PRs and post comments', icon: '🔍', requires: ['github'] },
  { name: 'send_slack_message', description: 'Post messages to Slack channels', icon: '💬', requires: ['slack'] },
  { name: 'send_email', description: 'Compose and send email via SMTP', icon: '📧', requires: ['smtp'] },
  { name: 'pushover_notify', description: 'Send Pushover push notifications', icon: '🔔', requires: ['pushover'] },
  { name: 'ntfy_alert', description: 'Publish alerts to ntfy.sh topics', icon: '📡', requires: ['ntfy'] },
  { name: 'homelab_ping', description: 'Ping homelab services and report status', icon: '🏠', requires: ['homelab'] },
  { name: 'web_search', description: 'Search the web via a configured search API', icon: '🌐', requires: [] },
  { name: 'eset_scan', description: 'Trigger ESET on-demand scans and read alerts', icon: '🛡', requires: ['eset'] },
];

export const NTFY_TOPIC_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const { loop, config, getTelegramPoller, setTelegramPollerRef, oauthState } = deps;

  // ── Gmail OAuth URL builder (protected — requires auth) ─────────────────────

  router.get('/oauth/gmail', (req, res) => {
    // Generate CSRF nonce: 32 random bytes = 64 hex chars
    const nonce = crypto.randomBytes(32).toString('hex');
    oauthState.set(nonce, Date.now());

    const redirectUri = `${req.protocol}://${req.get('host')}/api/admin/oauth/gmail/callback`;
    try {
      const url = generateOAuthUrl(redirectUri, nonce);
      res.json({ url });
    } catch (e) {
      oauthState.delete(nonce);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ── Google Calendar OAuth URL builder (protected — requires auth) ────────────

  router.get('/oauth/calendar', (req, res) => {
    const nonce = crypto.randomBytes(32).toString('hex');
    oauthState.set(nonce, Date.now());

    const redirectUri = `${req.protocol}://${req.get('host')}/api/admin/oauth/calendar/callback`;
    try {
      const url = generateCalendarOAuthUrl(redirectUri, nonce);
      res.json({ url });
    } catch (e) {
      oauthState.delete(nonce);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ── Memory ───────────────────────────────────────────────────────────────────

  router.get('/memory/engram', (_req, res) => {
    const state = loop.getState();
    res.json({
      engram: state.engramContext,
      spiderBrain: state.spiderBrainContext ?? null,
      engramEnabled: config.engramEnabled,
    });
  });

  router.get('/memory/files', (_req, res) => {
    const paths = projectMemoryPaths(config.projectPath);
    const files: Record<string, { content: string | null }> = {};
    for (const key of PM_FILES) {
      files[key] = { content: readMarkdownFile(paths[PM_KEY_MAP[key]] as string) };
    }
    res.json({ files, dir: paths.dir });
  });

  router.put('/memory/files/:file', (req, res) => {
    const file = ((req.params as { file: string }).file).toUpperCase() as PmFile;
    if (!PM_FILES.includes(file)) {
      res.status(400).json({ error: `Unknown file: ${file}` });
      return;
    }
    const content = (req.body as { content?: string }).content;
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content (string) is required' });
      return;
    }
    const paths = projectMemoryPaths(config.projectPath);
    writeMarkdownFile(paths[PM_KEY_MAP[file]] as string, content);
    res.json({ status: 'ok' });
  });

  router.get('/memory/facts', (_req, res) => {
    res.json({ facts: loadMemories() });
  });

  router.post('/memory/facts', (req, res) => {
    const fact = (req.body as { fact?: string }).fact;
    if (!fact?.trim()) {
      res.status(400).json({ error: 'fact (string) is required' });
      return;
    }
    addMemory(fact.trim());
    res.json({ status: 'ok' });
  });

  router.delete('/memory/facts', (req, res) => {
    const fact = (req.body as { fact?: string }).fact;
    if (!fact?.trim()) {
      res.status(400).json({ error: 'fact (string) is required' });
      return;
    }
    const removed = removeMemory(fact.trim());
    if (!removed) {
      res.status(404).json({ error: 'fact not found' });
      return;
    }
    res.json({ status: 'ok' });
  });

  router.post('/brain/rebuild', (_req, res) => {
    loop
      .rebuildBrain()
      .then((output) => res.json({ status: 'ok', output }))
      .catch((err: unknown) => {
        console.error('[koa] brain rebuild error:', err);
        res.status(500).json({ error: 'Internal server error' });
      });
  });

  router.get('/activity/sessions', (_req, res) => {
    const paths = projectMemoryPaths(config.projectPath);
    const sessions: { date: string; content: string }[] = [];
    try {
      const files = fs
        .readdirSync(paths.journalDir)
        .filter((f: string) => f.endsWith('.md'))
        .sort()
        .reverse();
      for (const file of files) {
        const content = readMarkdownFile(path.join(paths.journalDir, file));
        if (content) sessions.push({ date: file.replace('.md', ''), content });
      }
    } catch {
      /* journal dir may not exist yet */
    }
    res.json({ sessions });
  });

  // ── Config ───────────────────────────────────────────────────────────────────

  router.get('/config', (_req, res) => {
    const sbAvailable = loop.getState().spiderBrainContext?.available ?? false;
    const fileConf = readKoaConfigFile();
    const creds = readCredentials();
    res.json({
      model: config.model,
      maxTokens: config.maxTokens,
      projectPath: config.projectPath,
      defaultProjectPath: fileConf.defaultProjectPath ?? null,
      engramEnabled: config.engramEnabled,
      smartRouting: config.smartRouting,
      maxToolOutputChars: config.maxToolOutputChars,
      spiderBrainBrain: config.spiderBrainBrain ?? null,
      spiderBrainAvailable: sbAvailable,
      autoCheckpointTurns: config.autoCheckpointTurns,
      autoCheckpointMinutes: config.autoCheckpointMinutes,
      apiKeySet: !!config.apiKey,
      braveApiKey: !!creds['BRAVE_API_KEY'],
      autoChaining: config.autoChaining ?? false,
      briefingEnabled: config.briefingEnabled ?? false,
      briefingTime: config.briefingTime ?? '08:00',
      ttsProvider: config.ttsProvider ?? 'say',
      elevenLabsVoiceId: config.elevenLabsVoiceId ?? '21m00Tcm4TlvDq8ikWAM',
      elevenLabsModel: config.elevenLabsModel ?? 'eleven_turbo_v2_5',
      elevenLabsApiKey: !!creds['ELEVENLABS_API_KEY'],
      provider: config.provider ?? 'anthropic',
      ollamaModel: config.ollamaModel ?? 'llama3.2',
      ollamaBaseUrl: config.ollamaBaseUrl ?? 'http://localhost:11434',
      openaiCompatibleBaseUrl: config.openaiCompatibleBaseUrl ?? '',
      openaiCompatibleApiKeySet: !!config.openaiCompatibleApiKey,
      openaiCompatibleModel: config.openaiCompatibleModel ?? 'gpt-4o-mini',
      googleApiKeySet: !!config.googleApiKey,
      googleModel: config.googleModel ?? 'gemini-2.0-flash',
      sandboxBackend: config.sandboxBackend ?? 'local',
      sandboxTimeoutMs: config.sandboxTimeoutMs ?? 10000,
    });
  });

  router.put('/config', (req: Request, res: Response) => {
    const body = req.body as {
      model?: unknown;
      maxTokens?: unknown;
      maxToolOutputChars?: unknown;
      engramEnabled?: unknown;
      autoCheckpointTurns?: unknown;
      autoCheckpointMinutes?: unknown;
      smartRouting?: unknown;
      spiderBrainBrain?: unknown;
      defaultProjectPath?: unknown;
      apiKey?: unknown;
      braveApiKey?: unknown;
      autoChaining?: unknown;
      briefingEnabled?: unknown;
      briefingTime?: unknown;
      ttsProvider?: unknown;
      elevenLabsVoiceId?: unknown;
      elevenLabsModel?: unknown;
      elevenLabsApiKey?: unknown;
      provider?: unknown;
      ollamaModel?: unknown;
      ollamaBaseUrl?: unknown;
      openaiCompatibleBaseUrl?: unknown;
      openaiCompatibleApiKey?: unknown;
      openaiCompatibleModel?: unknown;
      googleApiKey?: unknown;
      googleModel?: unknown;
      sandboxBackend?: unknown;
      sandboxTimeoutMs?: unknown;
    };
    const updates: Record<string, unknown> = {};

    if (typeof body.model === 'string' && body.model.trim()) {
      updates['model'] = body.model.trim();
      config.model = body.model.trim();
    }
    if (typeof body.maxTokens === 'number') {
      updates['maxTokens'] = body.maxTokens;
      config.maxTokens = body.maxTokens;
    }
    if (typeof body.maxToolOutputChars === 'number') {
      updates['maxToolOutputChars'] = body.maxToolOutputChars;
      config.maxToolOutputChars = body.maxToolOutputChars;
    }
    if (typeof body.engramEnabled === 'boolean') {
      updates['engramEnabled'] = body.engramEnabled;
      config.engramEnabled = body.engramEnabled;
    }
    if (typeof body.autoCheckpointTurns === 'number') {
      updates['autoCheckpointTurns'] = body.autoCheckpointTurns;
      config.autoCheckpointTurns = body.autoCheckpointTurns;
    }
    if (typeof body.autoCheckpointMinutes === 'number') {
      updates['autoCheckpointMinutes'] = body.autoCheckpointMinutes;
      config.autoCheckpointMinutes = body.autoCheckpointMinutes;
    }
    if (typeof body.smartRouting === 'boolean') {
      updates['smartRouting'] = body.smartRouting;
      config.smartRouting = body.smartRouting;
    }
    if (typeof body.autoChaining === 'boolean') {
      updates['autoChaining'] = body.autoChaining;
      config.autoChaining = body.autoChaining;
    }
    if (typeof body.spiderBrainBrain === 'string') {
      const val = body.spiderBrainBrain.trim() || undefined;
      updates['spiderBrainBrain'] = val;
      config.spiderBrainBrain = val;
    }
    if (typeof body.defaultProjectPath === 'string') {
      const val = body.defaultProjectPath.trim() || undefined;
      updates['defaultProjectPath'] = val;
    }
    // apiKey goes to credentials file, not config.json
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      const key = body.apiKey.trim();
      setApiKey(key);
      config.apiKey = key;
      loop.updateApiKey(key);
    }
    // braveApiKey goes to credentials file, not config.json
    if (typeof body.braveApiKey === 'string') {
      if (body.braveApiKey.length > 256) {
        return res.status(400).json({ error: 'braveApiKey too long' });
      }
      if (body.braveApiKey) {
        writeCredential('BRAVE_API_KEY', body.braveApiKey);
      } else {
        deleteCredential('BRAVE_API_KEY');
      }
    }
    if (typeof body.briefingEnabled === 'boolean') {
      updates['briefingEnabled'] = body.briefingEnabled;
      config.briefingEnabled = body.briefingEnabled;
    }
    if (typeof body.briefingTime === 'string') {
      const match = /^(\d{2}):(\d{2})$/.exec(body.briefingTime);
      if (!match) {
        return res.status(400).json({ error: 'briefingTime must be HH:MM' });
      }
      const hh = parseInt(match[1]!, 10);
      const mm = parseInt(match[2]!, 10);
      if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
        return res.status(400).json({ error: 'briefingTime out of range' });
      }
      updates['briefingTime'] = body.briefingTime;
      config.briefingTime = body.briefingTime;
    }
    if (typeof body.ttsProvider === 'string') {
      if (body.ttsProvider !== 'say' && body.ttsProvider !== 'elevenlabs') {
        return res.status(400).json({ error: 'ttsProvider must be say or elevenlabs' });
      }
      updates['ttsProvider'] = body.ttsProvider;
      config.ttsProvider = body.ttsProvider as 'say' | 'elevenlabs';
    }
    if (typeof body.elevenLabsVoiceId === 'string') {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(body.elevenLabsVoiceId)) {
        return res.status(400).json({ error: 'elevenLabsVoiceId invalid' });
      }
      updates['elevenLabsVoiceId'] = body.elevenLabsVoiceId;
      config.elevenLabsVoiceId = body.elevenLabsVoiceId;
    }
    if (typeof body.elevenLabsModel === 'string') {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(body.elevenLabsModel)) {
        return res.status(400).json({ error: 'elevenLabsModel invalid' });
      }
      updates['elevenLabsModel'] = body.elevenLabsModel;
      config.elevenLabsModel = body.elevenLabsModel;
    }
    // elevenLabsApiKey goes to credentials file, not config.json
    if (typeof body.elevenLabsApiKey === 'string') {
      if (body.elevenLabsApiKey.length > 256) {
        return res.status(400).json({ error: 'elevenLabsApiKey too long' });
      }
      if (body.elevenLabsApiKey) {
        writeCredential('ELEVENLABS_API_KEY', body.elevenLabsApiKey);
      } else {
        deleteCredential('ELEVENLABS_API_KEY');
      }
    }

    if (typeof body.provider === 'string') {
      const validProviders = ['anthropic', 'ollama', 'openai-compatible', 'google'];
      if (!validProviders.includes(body.provider)) {
        return res.status(400).json({ error: 'provider must be anthropic, ollama, openai-compatible, or google' });
      }
      updates['provider'] = body.provider;
      config.provider = body.provider as 'anthropic' | 'ollama' | 'openai-compatible' | 'google';
    }
    if (typeof body.ollamaModel === 'string' && body.ollamaModel.trim()) {
      if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(body.ollamaModel.trim())) {
        return res.status(400).json({ error: 'ollamaModel invalid' });
      }
      updates['ollamaModel'] = body.ollamaModel.trim();
      config.ollamaModel = body.ollamaModel.trim();
    }
    if (typeof body.ollamaBaseUrl === 'string' && body.ollamaBaseUrl.trim()) {
      const url = body.ollamaBaseUrl.trim();
      if (!isOllamaUrl(url)) {
        return res.status(400).json({ error: 'ollamaBaseUrl must be a private/local address' });
      }
      updates['ollamaBaseUrl'] = url;
      config.ollamaBaseUrl = url;
    }
    if (typeof body.openaiCompatibleBaseUrl === 'string' && body.openaiCompatibleBaseUrl.trim()) {
      const rawUrl = body.openaiCompatibleBaseUrl.trim();
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return res.status(400).json({ error: 'openaiCompatibleBaseUrl must be http or https' });
        }
      } catch {
        return res.status(400).json({ error: 'openaiCompatibleBaseUrl is not a valid URL' });
      }
      updates['openaiCompatibleBaseUrl'] = rawUrl;
      config.openaiCompatibleBaseUrl = rawUrl;
    }
    if (typeof body.openaiCompatibleApiKey === 'string') {
      if (body.openaiCompatibleApiKey.length > 256) {
        return res.status(400).json({ error: 'openaiCompatibleApiKey too long' });
      }
      if (body.openaiCompatibleApiKey) {
        writeCredential('OPENAI_COMPAT_API_KEY', body.openaiCompatibleApiKey);
        config.openaiCompatibleApiKey = body.openaiCompatibleApiKey;
      } else {
        deleteCredential('OPENAI_COMPAT_API_KEY');
        config.openaiCompatibleApiKey = undefined;
      }
    }
    if (typeof body.openaiCompatibleModel === 'string' && body.openaiCompatibleModel.trim()) {
      if (!/^[a-zA-Z0-9._/:-]{1,128}$/.test(body.openaiCompatibleModel.trim())) {
        return res.status(400).json({ error: 'openaiCompatibleModel invalid' });
      }
      updates['openaiCompatibleModel'] = body.openaiCompatibleModel.trim();
      config.openaiCompatibleModel = body.openaiCompatibleModel.trim();
    }
    if (typeof body.googleApiKey === 'string') {
      if (body.googleApiKey.length > 256) {
        return res.status(400).json({ error: 'googleApiKey too long' });
      }
      if (body.googleApiKey) {
        writeCredential('GOOGLE_API_KEY', body.googleApiKey);
        config.googleApiKey = body.googleApiKey;
      } else {
        deleteCredential('GOOGLE_API_KEY');
        config.googleApiKey = undefined;
      }
    }
    if (typeof body.googleModel === 'string' && body.googleModel.trim()) {
      if (!/^[a-zA-Z0-9._/-]{1,128}$/.test(body.googleModel.trim())) {
        return res.status(400).json({ error: 'googleModel invalid' });
      }
      updates['googleModel'] = body.googleModel.trim();
      config.googleModel = body.googleModel.trim();
    }

    if (typeof body.sandboxBackend === 'string') {
      if (body.sandboxBackend !== 'local' && body.sandboxBackend !== 'docker') {
        return res.status(400).json({ error: 'sandboxBackend must be local or docker' });
      }
      updates['sandboxBackend'] = body.sandboxBackend;
      config.sandboxBackend = body.sandboxBackend as 'local' | 'docker';
    }
    if (typeof body.sandboxTimeoutMs === 'number') {
      if (body.sandboxTimeoutMs < 1000 || body.sandboxTimeoutMs > 300_000) {
        return res.status(400).json({ error: 'sandboxTimeoutMs must be between 1000 and 300000' });
      }
      updates['sandboxTimeoutMs'] = body.sandboxTimeoutMs;
      config.sandboxTimeoutMs = body.sandboxTimeoutMs;
    }

    writeKoaConfigFile(updates);
    res.json({ status: 'ok' });
  });

  // ── Sandbox ───────────────────────────────────────────────────────────────────

  router.get('/sandbox/status', (_req, res) => {
    const backend = config.sandboxBackend ?? 'local';
    if (backend !== 'docker') {
      res.json({ available: true, backend: 'local' });
      return;
    }
    DockerRunner.isAvailable()
      .then((available) => res.json({ available, backend: 'docker' }))
      .catch(() => res.json({ available: false, backend: 'docker' }));
  });

  // ── Browser Automation ───────────────────────────────────────────────────────

  router.get('/browser/status', (_req, res) => {
    let playwrightInstalled = false;
    try {
      require.resolve('playwright');
      playwrightInstalled = true;
    } catch {
      playwrightInstalled = false;
    }
    res.json({ available: isBrowserAvailable(), playwrightInstalled });
  });

  router.post('/browser/install', (_req, res: Response) => {
    // Idempotency guard: skip the spawn if Playwright is already installed.
    let alreadyInstalled = false;
    try { require.resolve('playwright'); alreadyInstalled = true; } catch { /* not installed */ }
    if (alreadyInstalled) {
      return res.status(200).type('text/plain').send('Playwright is already installed.\n');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const child = spawn('npx', ['playwright', 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      res.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      res.write(chunk);
    });
    child.on('close', (code) => {
      if (code === 0) {
        res.status(200).end();
      } else {
        res.status(500).end(`\nProcess exited with code ${code}\n`);
      }
    });
    child.on('error', (err) => {
      res.status(500).end(`\nFailed to spawn install: ${err.message}\n`);
    });
  });

  // ── Ollama model list ─────────────────────────────────────────────────────────

  router.get('/ollama/models', async (_req, res: Response) => {
    const baseUrl = config.ollamaBaseUrl ?? 'http://localhost:11434';
    // SSRF guard: only fetch from already-validated localhost URL stored in config
    if (!isOllamaUrl(baseUrl)) {
      return res.status(400).json({ error: 'ollamaBaseUrl is not a private/local address' });
    }
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        return res.status(502).json({ error: `Ollama returned ${response.status}` });
      }
      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = (data.models ?? []).map((m) => m.name);
      return res.json({ models });
    } catch (err) {
      return res.status(502).json({ error: `Cannot reach Ollama: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  // ── Integrations ─────────────────────────────────────────────────────────────

  router.get('/integrations', (_req, res) => {
    const integrations = loadIntegrations().map(maskSecrets);
    res.json({ integrations });
  });

  router.put('/integrations/:id', (req, res) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as { type?: unknown; name?: unknown; config?: unknown };
    if (typeof body.type !== 'string' || !ALLOWED_TYPES.has(body.type)) {
      res.status(400).json({ error: `Invalid or missing integration type` });
      return;
    }
    if (typeof body.name !== 'string' || !body.name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    if (typeof body.config !== 'object' || body.config === null) {
      res.status(400).json({ error: 'config object is required' });
      return;
    }
    const submittedRaw = body.config as Record<string, unknown>;
    if (body.type === 'ntfy' && submittedRaw['topic'] !== undefined) {
      const topic = submittedRaw['topic'];
      if (typeof topic !== 'string' || !NTFY_TOPIC_RE.test(topic)) {
        res.status(400).json({ error: 'ntfy topic must be 1–64 alphanumeric, hyphen, or underscore characters' });
        return;
      }
    }
    const existing = loadIntegrations().find(i => i.id === id);
    const mergedConfig = mergeConfig(existing?.config ?? {}, submittedRaw as Record<string, string>, body.type);
    const hasValues = Object.values(mergedConfig).some(v => v && v !== '***');
    const integration = {
      id,
      type: body.type,
      name: body.name.trim(),
      status: (hasValues ? 'connected' : 'not_configured') as 'connected' | 'not_configured',
      config: mergedConfig,
    };
    saveIntegration(integration);
    res.json({ status: 'ok', integration: maskSecrets(integration) });
  });

  router.delete('/integrations/:id', (req, res) => {
    const id = (req.params as { id: string }).id;
    const removed = deleteIntegration(id);
    if (!removed) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    res.json({ status: 'ok' });
  });

  router.post('/integrations/:id/test', (req, res) => {
    const id = (req.params as { id: string }).id;
    const integration = loadIntegrations().find(i => i.id === id);
    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    if (integration.type === 'ntfy') {
      const topic = integration.config['topic'];
      const baseUrl = integration.config['baseUrl'] || 'https://ntfy.sh';
      if (!topic) { res.json({ ok: false, message: 'topic not configured' }); return; }
      try { validateSafeUrl(baseUrl); } catch (e) {
        res.json({ ok: false, message: (e as Error).message }); return;
      }
      fetch(`${baseUrl}/${encodeURIComponent(topic)}/json?poll=1&since=all`)
        .then(r => res.json({ ok: r.ok, message: r.ok ? 'Connected' : `HTTP ${r.status}` }))
        .catch(err => res.json({ ok: false, message: (err as Error).message }));
      return;
    }
    if (integration.type === 'github') {
      const token = integration.config['token'];
      if (!token || token === '***') { res.json({ ok: false, message: 'token not configured' }); return; }
      fetch('https://api.github.com/user', {
        headers: { 'Authorization': `token ${token}`, 'User-Agent': 'koa-agent/1.0' },
      })
        .then(r => {
          if (r.ok) {
            return r.json().then((data: unknown) => {
              const login = (data as { login?: string }).login;
              res.json({ ok: true, message: `Connected as ${login ?? 'unknown'}` });
            });
          }
          res.json({ ok: false, message: `HTTP ${r.status}` });
        })
        .catch(err => res.json({ ok: false, message: (err as Error).message }));
      return;
    }
    if (integration.type === 'slack') {
      const webhookUrl = integration.config['webhookUrl'];
      if (!webhookUrl || webhookUrl === '***') { res.json({ ok: false, message: 'webhook URL not configured' }); return; }
      try { validateSafeUrl(webhookUrl, h => h === 'hooks.slack.com'); } catch (e) {
        res.json({ ok: false, message: (e as Error).message }); return;
      }
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Koa connection test ✓' }),
      })
        .then(r => res.json({ ok: r.ok, message: r.ok ? 'Connected' : `HTTP ${r.status}` }))
        .catch(err => res.json({ ok: false, message: (err as Error).message }));
      return;
    }
    if (integration.type === 'pushover') {
      const userKey = integration.config['userKey'];
      const appToken = integration.config['appToken'];
      if (!userKey || userKey === '***' || !appToken || appToken === '***') {
        res.json({ ok: false, message: 'userKey and appToken required' });
        return;
      }
      const pushoverBody = new URLSearchParams({ token: appToken, user: userKey });
      fetch('https://api.pushover.net/1/users/validate.json', { method: 'POST', body: pushoverBody })
        .then(r => r.json())
        .then((data: unknown) => {
          const d = data as { status?: number; errors?: string[] };
          res.json({
            ok: d.status === 1,
            message: d.status === 1 ? 'Valid credentials' : (d.errors?.join(', ') ?? 'Invalid credentials'),
          });
        })
        .catch(err => res.json({ ok: false, message: (err as Error).message }));
      return;
    }
    res.json({ ok: false, message: 'Connection test not implemented for this integration type' });
  });

  // ── Notifications ─────────────────────────────────────────────────────────────

  router.get('/notifications', (_req, res) => {
    res.json({ rules: loadRules(), quietHours: loadQuietHours(), escalation: loadEscalationSettings() });
  });

  router.put('/notifications/rules', (req, res) => {
    const body = req.body as { rules?: unknown };
    if (!Array.isArray(body.rules)) {
      res.status(400).json({ error: 'rules (array) is required' });
      return;
    }
    saveRules(body.rules as Parameters<typeof saveRules>[0]);
    res.json({ status: 'ok' });
  });

  router.put('/notifications/quiet-hours', (req, res) => {
    const body = req.body as { enabled?: unknown; from?: unknown; to?: unknown };
    if (typeof body.enabled !== 'boolean' || typeof body.from !== 'string' || typeof body.to !== 'string') {
      res.status(400).json({ error: 'enabled (bool), from (string), to (string) are required' });
      return;
    }
    saveQuietHours({ enabled: body.enabled, from: body.from, to: body.to });
    res.json({ status: 'ok' });
  });

  router.post('/notifications/test', (req, res) => {
    const body = req.body as { channel?: unknown };
    if (typeof body.channel !== 'string') {
      res.status(400).json({ error: 'channel (string) is required' });
      return;
    }
    const integration = loadIntegrations().find(i => i.id === body.channel || i.type === body.channel);
    if (!integration) {
      res.json({ ok: false, message: 'Integration not configured' });
      return;
    }
    if (integration.type === 'ntfy') {
      const topic = integration.config['topic'];
      const baseUrl = integration.config['baseUrl'] || 'https://ntfy.sh';
      if (!topic) {
        res.json({ ok: false, message: 'ntfy topic not set' });
        return;
      }
      try { validateSafeUrl(baseUrl); } catch (e) {
        res.json({ ok: false, message: (e as Error).message }); return;
      }
      fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'Koa notification test ✓',
      })
        .then(r => res.json({ ok: r.ok, message: r.ok ? 'Test notification sent' : `HTTP ${r.status}` }))
        .catch(err => res.json({ ok: false, message: (err as Error).message }));
      return;
    }
    res.json({ ok: false, message: 'Test send not implemented for this channel type' });
  });

  router.put('/notifications/escalation', (req, res) => {
    const body = req.body as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled (bool) is required' });
      return;
    }
    saveEscalationSettings({ enabled: body.enabled });
    escalationScheduler.updateConfig({ enabled: body.enabled });
    res.json({ status: 'ok' });
  });

  router.post('/ntfy/test', (_req, res) => {
    const creds = readCredentials();
    const topic = creds['NTFY_TOPIC'];
    const baseUrl = creds['NTFY_BASE_URL'] ?? 'https://ntfy.sh';

    if (!topic) {
      res.status(400).json({ error: 'NTFY_TOPIC not set in credentials' });
      return;
    }

    try {
      validateSafeUrl(baseUrl);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'Koa ntfy test ✓',
    })
      .then((r) => res.json({ ok: r.ok, message: r.ok ? 'Test notification sent' : `HTTP ${r.status}` }))
      .catch((err: unknown) => res.json({ ok: false, message: err instanceof Error ? err.message : String(err) }));
  });

  // ── Skills ────────────────────────────────────────────────────────────────────

  router.get('/skills', (_req, res) => {
    const customSkills = loadCustomSkills();
    const customNames = new Set(customSkills.map(s => s.name));
    const pluginToolNames = new Set(
      loadPlugins().flatMap(p => p.tools.map(t => t.name))
    );
    const installedTools = loop.getTools();
    const installed = installedTools.map(t => ({
      name: t.name,
      description: t.description,
      source: customNames.has(t.name) ? 'custom' : pluginToolNames.has(t.name) ? 'plugin' : 'built-in' as 'built-in' | 'custom' | 'plugin',
      status: 'active' as const,
      ...(customNames.has(t.name)
        ? { type: customSkills.find(s => s.name === t.name)!.type }
        : {}),
    }));
    const installedNames = new Set(installedTools.map(t => t.name));
    const marketplace = MARKETPLACE.filter(m => !installedNames.has(m.name));
    res.json({ installed, marketplace });
  });

  router.get('/plugins', (_req, res) => {
    const plugins = loadPlugins();
    res.json(plugins.map(p => ({
      name: p.name,
      version: p.version,
      description: p.description,
      toolCount: p.tools.length,
      toolNames: p.tools.map(t => t.name),
      sourcePath: p.sourcePath,
    })));
  });

  router.post('/skills/custom', (req, res) => {
    const body = req.body as {
      name?: unknown;
      description?: unknown;
      type?: unknown;
      config?: unknown;
      createdAt?: unknown;
    };
    if (typeof body.name !== 'string' || !/^[a-z][a-z0-9_]{1,49}$/.test(body.name)) {
      res.status(400).json({ error: 'name must match /^[a-z][a-z0-9_]{1,49}$/' });
      return;
    }
    if (typeof body.description !== 'string') {
      res.status(400).json({ error: 'description (string) is required' });
      return;
    }
    if (body.type !== 'bash' && body.type !== 'http' && body.type !== 'mcp') {
      res.status(400).json({ error: 'type must be bash | http | mcp' });
      return;
    }
    if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
      res.status(400).json({ error: 'config (object) is required' });
      return;
    }
    saveCustomSkill({
      name: body.name,
      description: body.description,
      type: body.type,
      config: body.config as Record<string, string>,
      createdAt: typeof body.createdAt === 'string' ? body.createdAt : new Date().toISOString(),
    });
    res.json({ status: 'ok' });
  });

  router.delete('/skills/custom/:name', (req, res) => {
    const name = (req.params as { name: string }).name;
    deleteCustomSkill(name);
    res.json({ ok: true });
  });

  // ── Telegram ──────────────────────────────────────────────────────────────────

  router.post('/telegram', (req: Request, res: Response) => {
    const { botToken, defaultChatId } = req.body as { botToken?: string; defaultChatId?: string };
    if (botToken !== undefined) {
      if (botToken === '') {
        deleteCredential('TELEGRAM_BOT_TOKEN');
        getTelegramPoller()?.stop();
        setTelegramPollerRef(null);
        setTelegramPoller(null);
      } else {
        writeCredential('TELEGRAM_BOT_TOKEN', botToken.slice(0, 128));
        getTelegramPoller()?.stop();
        const poller = new TelegramPoller(botToken.slice(0, 128), loop);
        poller.start();
        setTelegramPollerRef(poller);
        setTelegramPoller(poller);
      }
    }
    if (defaultChatId !== undefined) {
      if (defaultChatId === '') {
        deleteCredential('TELEGRAM_DEFAULT_CHAT_ID');
      } else {
        writeCredential('TELEGRAM_DEFAULT_CHAT_ID', defaultChatId.slice(0, 64));
      }
    }
    res.json({ ok: true });
  });

  router.get('/telegram', (_req: Request, res: Response) => {
    const creds = readCredentials();
    res.json({
      configured: !!creds['TELEGRAM_BOT_TOKEN'],
      hasDefaultChatId: !!creds['TELEGRAM_DEFAULT_CHAT_ID'],
      polling: getTelegramPoller() !== null,
    });
  });

  // ── Delegations ───────────────────────────────────────────────────────────────

  router.get('/delegations', (_req, res) => {
    res.json(listDelegations());
  });

  router.post('/delegations', (req, res) => {
    const { pattern, action, schedule, enabled } = req.body as Record<string, unknown>;
    if (typeof pattern !== 'string' || typeof action !== 'string' || typeof schedule !== 'string' ||
        !pattern.trim() || !action.trim() || !schedule.trim()) {
      res.status(400).json({ error: 'pattern, action, and schedule must be non-empty strings' });
      return;
    }
    if (action.length > 2000) {
      res.status(400).json({ error: 'action must be 2000 characters or fewer' });
      return;
    }
    let d = createDelegation({ pattern, action, schedule });
    if (enabled === false) {
      updateDelegation(d.id, { enabled: 0 });
      d = getDelegation(d.id)!;
    }
    res.status(201).json(d);
  });

  router.put('/delegations/:id', (req, res) => {
    const existing = getDelegation(req.params['id']!);
    if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
    const body = req.body as Partial<Delegation>;
    if (typeof body.action === 'string' && body.action.length > 2000) {
      res.status(400).json({ error: 'action must be 2000 characters or fewer' });
      return;
    }
    updateDelegation(req.params['id']!, body);
    res.json(getDelegation(req.params['id']!));
  });

  router.delete('/delegations/:id', (req, res) => {
    const d = getDelegation(req.params['id']!);
    if (!d) { res.status(404).json({ error: 'Not found' }); return; }
    deleteDelegation(req.params['id']!);
    res.status(204).send();
  });

  // ── MCP servers ───────────────────────────────────────────────────────────────

  router.get('/mcp/servers', (_req, res) => {
    const servers = (config.mcpServers ?? []).map((s) => ({
      name: s.name,
      command: s.command,
      trusted: s.trusted ?? false,
    }));
    res.json({ servers });
  });

  // ── Software update ───────────────────────────────────────────────────────────

  router.get('/update/check', async (_req, res: Response) => {
    const { runUpdate } = await import('../../updater/index.js');
    const result = await runUpdate({ check: true });
    res.json(result);
  });

  router.post('/update', async (req, res: Response) => {
    const body = req.body as { test?: unknown };
    const runTests = body.test !== false; // default true
    const { runUpdate } = await import('../../updater/index.js');
    const result = await runUpdate({ test: runTests, log: (msg) => process.stdout.write(`[koa/update] ${msg}\n`) });
    res.json(result);
  });

  return router;
}
