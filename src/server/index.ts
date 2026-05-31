import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import { writeKoaConfigFile } from '../config/index.js';
import type { SseEvent } from './events.js';
import { projectMemoryPaths } from '../project-memory/paths.js';
import { readMarkdownFile, writeMarkdownFile } from '../project-memory/store.js';
import { loadMemories, addMemory, removeMemory } from '../memory/store.js';
import {
  loadIntegrations,
  saveIntegration,
  deleteIntegration,
  maskSecrets,
  mergeConfig,
  ALLOWED_TYPES,
} from '../integrations/store.js';
import {
  loadRules,
  saveRules,
  loadQuietHours,
  saveQuietHours,
} from '../notifications/store.js';
import {
  loadCustomSkills,
  saveCustomSkill,
  deleteCustomSkill,
} from '../skills/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Constant-time token comparison: HMAC both values to a fixed length before comparing,
// eliminating the length oracle that padding-based approaches suffer from.
function tokenEqual(a: string, b: string): boolean {
  const key = 'koa-token-verify';
  const ha = crypto.createHmac('sha256', key).update(a).digest();
  const hb = crypto.createHmac('sha256', key).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later' },
});

export function createServer(loop: AgentLoop, config: KoaConfig, devPort = 5173) {
  const app = express();
  // Allow requests only from the Vite dev server (dev) or same origin (prod built UI).
  // Never allow wildcard — the bash tool gives full shell access.
  app.use(cors({ origin: `http://localhost:${devPort}` }));
  app.use(express.json());

  // Unauthenticated health check — does not reveal whether auth is configured
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });

  // Token verification — rate-limited to prevent brute-force
  app.post('/api/auth', authRateLimit, (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (!config.webToken) { res.json({ ok: true }); return; }
    if (!token) { res.status(400).json({ error: 'token required' }); return; }
    if (tokenEqual(token, config.webToken)) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'invalid token' });
    }
  });

  // Bearer token auth for all /api/ routes when a token is configured
  app.use('/api/', (req: Request, res: Response, next: NextFunction) => {
    if (!config.webToken) { next(); return; }
    const header = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) { res.status(401).json({ error: 'Authorization required' }); return; }
    if (tokenEqual(token, config.webToken)) { next(); return; }
    res.status(401).json({ error: 'Invalid token' });
  });

  let isBusy = false;

  app.get('/api/context', (_req, res) => {
    const state = loop.getState();
    res.json({
      context: state.engramContext,
      model: config.model,
      turnCount: state.turnCount,
      engramEnabled: config.engramEnabled,
      activeModel: state.lastModel ?? config.model,
      activeTier: state.lastTier ?? 'sonnet',
      usage: state.usage,
      spiderBrain: state.spiderBrainContext ?? null,
    });
  });

  app.post('/api/checkpoint', (_req, res) => {
    if (isBusy) {
      res.status(409).json({ error: 'Agent turn in progress — retry after current response finishes' });
      return;
    }
    loop
      .checkpoint()
      .then(() => res.json({ status: 'ok', message: 'Checkpoint saved.' }))
      .catch((err: unknown) =>
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) }),
      );
  });

  app.post('/api/chat', (req, res) => {
    const message = (req.body as { message?: string }).message;
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    if (isBusy) {
      res.status(429).json({ error: 'Agent is busy — wait for the current response to finish' });
      return;
    }

    isBusy = true;
    let disconnected = false;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Release the lock immediately if the client disconnects mid-stream
    req.on('close', () => {
      disconnected = true;
      isBusy = false;
    });

    const send = (event: SseEvent) => {
      if (!disconnected) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    loop
      .turn(message, {
        onToolCall: (name, input) => send({ type: 'tool_call', name, input }),
        onToolResult: (name, result) => send({ type: 'tool_result', name, result }),
        onClassifying: () => send({ type: 'classifying' }),
        onClassified: (tier) => send({ type: 'classified', tier }),
      })
      .then((result) => {
        send({ type: 'content', text: result.content });
        if (result.usage) {
          send({ type: 'usage', turn: result.usage, session: loop.getState().usage });
        }
        send({
          type: 'done',
          turnCount: loop.getState().turnCount,
          model: result.model,
          tier: result.tier,
          ...(result.classifierLatencyMs !== undefined
            ? { classifierLatencyMs: result.classifierLatencyMs }
            : {}),
        });
        if (!disconnected) res.end();
      })
      .catch((err: unknown) => {
        // Keep full error server-side; send a sanitised message to the client
        console.error('[koa] agent error:', err);
        send({ type: 'error', message: 'Agent error — see server logs' });
        if (!disconnected) res.end();
      })
      .finally(() => {
        isBusy = false;
      });
  });

  // ── Admin: config ───────────────────────────────────────────────────────────

  const PM_FILES = ['PROJECT', 'STATE', 'BACKLOG', 'HANDOFF'] as const;
  type PmFile = (typeof PM_FILES)[number];
  const PM_KEY_MAP: Record<PmFile, keyof ReturnType<typeof projectMemoryPaths>> = {
    PROJECT: 'projectMd',
    STATE: 'stateMd',
    BACKLOG: 'backlogMd',
    HANDOFF: 'handoffMd',
  };

  app.get('/api/admin/memory/engram', (_req, res) => {
    const state = loop.getState();
    res.json({
      engram: state.engramContext,
      spiderBrain: state.spiderBrainContext ?? null,
      engramEnabled: config.engramEnabled,
    });
  });

  app.get('/api/admin/memory/files', (_req, res) => {
    const paths = projectMemoryPaths(config.projectPath);
    const files: Record<string, { content: string | null }> = {};
    for (const key of PM_FILES) {
      files[key] = { content: readMarkdownFile(paths[PM_KEY_MAP[key]] as string) };
    }
    res.json({ files, dir: paths.dir });
  });

  app.put('/api/admin/memory/files/:file', (req, res) => {
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

  app.get('/api/admin/memory/facts', (_req, res) => {
    res.json({ facts: loadMemories() });
  });

  app.post('/api/admin/memory/facts', (req, res) => {
    const fact = (req.body as { fact?: string }).fact;
    if (!fact?.trim()) {
      res.status(400).json({ error: 'fact (string) is required' });
      return;
    }
    addMemory(fact.trim());
    res.json({ status: 'ok' });
  });

  app.delete('/api/admin/memory/facts', (req, res) => {
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

  app.post('/api/admin/brain/rebuild', (_req, res) => {
    loop
      .rebuildBrain()
      .then((output) => res.json({ status: 'ok', output }))
      .catch((err: unknown) =>
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) }),
      );
  });

  app.get('/api/admin/activity/sessions', (_req, res) => {
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

  app.get('/api/admin/config', (_req, res) => {
    res.json({
      model: config.model,
      maxTokens: config.maxTokens,
      projectPath: config.projectPath,
      engramEnabled: config.engramEnabled,
      smartRouting: config.smartRouting,
      maxToolOutputChars: config.maxToolOutputChars,
      compactAfterTurns: config.compactAfterTurns,
      spiderBrainBrain: config.spiderBrainBrain ?? null,
      autoCheckpointTurns: config.autoCheckpointTurns,
      autoCheckpointMinutes: config.autoCheckpointMinutes,
      apiKeySet: !!config.apiKey,
    });
  });

  app.put('/api/admin/config', (req, res) => {
    const body = req.body as {
      autoCheckpointTurns?: unknown;
      autoCheckpointMinutes?: unknown;
      smartRouting?: unknown;
      compactAfterTurns?: unknown;
    };
    const updates: Record<string, unknown> = {};
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
    if (typeof body.compactAfterTurns === 'number') {
      updates['compactAfterTurns'] = body.compactAfterTurns;
      config.compactAfterTurns = body.compactAfterTurns;
    }
    writeKoaConfigFile(updates);
    res.json({ status: 'ok' });
  });

  // ── Admin: integrations ─────────────────────────────────────────────────────

  app.get('/api/admin/integrations', (_req, res) => {
    const integrations = loadIntegrations().map(maskSecrets);
    res.json({ integrations });
  });

  app.put('/api/admin/integrations/:id', (req, res) => {
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
    const existing = loadIntegrations().find(i => i.id === id);
    const submittedConfig = body.config as Record<string, string>;
    const mergedConfig = mergeConfig(existing?.config ?? {}, submittedConfig, body.type);
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

  app.delete('/api/admin/integrations/:id', (req, res) => {
    const id = (req.params as { id: string }).id;
    const removed = deleteIntegration(id);
    if (!removed) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    res.json({ status: 'ok' });
  });

  app.post('/api/admin/integrations/:id/test', (req, res) => {
    const id = (req.params as { id: string }).id;
    const integration = loadIntegrations().find(i => i.id === id);
    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }
    // ntfy has a real test: send a GET to the topic info endpoint
    if (integration.type === 'ntfy') {
      const topic = integration.config['topic'];
      const baseUrl = integration.config['baseUrl'] || 'https://ntfy.sh';
      if (!topic) {
        res.json({ ok: false, message: 'topic not configured' });
        return;
      }
      fetch(`${baseUrl}/${topic}/json?poll=1&since=all`)
        .then(r => res.json({ ok: r.ok, message: r.ok ? 'Connected' : `HTTP ${r.status}` }))
        .catch(err => res.json({ ok: false, message: (err as Error).message }));
      return;
    }
    res.json({ ok: false, message: 'Connection test not implemented for this integration type' });
  });

  // ── Admin: notifications ────────────────────────────────────────────────────

  app.get('/api/admin/notifications', (_req, res) => {
    res.json({ rules: loadRules(), quietHours: loadQuietHours() });
  });

  app.put('/api/admin/notifications/rules', (req, res) => {
    const body = req.body as { rules?: unknown };
    if (!Array.isArray(body.rules)) {
      res.status(400).json({ error: 'rules (array) is required' });
      return;
    }
    saveRules(body.rules as Parameters<typeof saveRules>[0]);
    res.json({ status: 'ok' });
  });

  app.put('/api/admin/notifications/quiet-hours', (req, res) => {
    const body = req.body as { enabled?: unknown; from?: unknown; to?: unknown };
    if (typeof body.enabled !== 'boolean' || typeof body.from !== 'string' || typeof body.to !== 'string') {
      res.status(400).json({ error: 'enabled (bool), from (string), to (string) are required' });
      return;
    }
    saveQuietHours({ enabled: body.enabled, from: body.from, to: body.to });
    res.json({ status: 'ok' });
  });

  app.post('/api/admin/notifications/test', (req, res) => {
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
      fetch(`${baseUrl}/${topic}`, {
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

  // ── Admin: skills ───────────────────────────────────────────────────────────

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

  app.get('/api/admin/skills', (_req, res) => {
    const customSkills = loadCustomSkills();
    const customNames = new Set(customSkills.map(s => s.name));
    const installedTools = loop.getTools();
    const installed = installedTools.map(t => ({
      name: t.name,
      description: t.description,
      source: customNames.has(t.name) ? 'custom' : 'built-in' as 'built-in' | 'custom',
      status: 'active' as const,
      ...(customNames.has(t.name)
        ? { type: customSkills.find(s => s.name === t.name)!.type }
        : {}),
    }));
    const installedNames = new Set(installedTools.map(t => t.name));
    const marketplace = MARKETPLACE.filter(m => !installedNames.has(m.name));
    res.json({ installed, marketplace });
  });

  app.post('/api/admin/skills/custom', (req, res) => {
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

  app.delete('/api/admin/skills/custom/:name', (req, res) => {
    const name = (req.params as { name: string }).name;
    deleteCustomSkill(name);
    res.json({ ok: true });
  });

  // Serve built web UI; fall back gracefully when not yet built
  const webDist = path.join(__dirname, '../../web/dist');
  app.use(express.static(webDist));
  app.get('/{*path}', (req, res) => {
    const index = path.join(webDist, 'index.html');
    res.sendFile(index, (err) => {
      if (err) {
        res.status(200).send(
          '<pre>Web UI not built yet.\nRun: cd web && npm install && npm run build</pre>',
        );
      }
    });
  });

  return app;
}
