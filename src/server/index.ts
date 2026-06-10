import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { IncomingMessage, ServerResponse } from 'http';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import { readCredentials } from '../config/credentials.js';
import { gmailPoller } from '../channels/gmail.js';
import { calendarSync } from '../calendar/sync.js';
import { escalationScheduler } from '../notifications/escalation.js';
import { TelegramPoller } from '../channels/telegram.js';
import { setTelegramPoller } from '../channels/router.js';
import { tokenEqual } from './utils.js';
import { buildDailyBriefing } from '../proactive/briefing.js';
import { runDueDelegations } from '../proactive/delegations.js';
import { routeResponse } from '../channels/router.js';
import { createChatRouter } from './routes/chat.js';
import { createAdminRouter, createOAuthCallbackRouter } from './routes/admin.js';
import type { OAuthStateMap } from './routes/admin.js';
import { createDbRouter } from './routes/db.js';
import { createPushRouter } from './routes/push.js';
import { createCalendarRouter } from './routes/calendar.js';
import { createWebhooksRouter, createVoiceRouter } from './routes/webhooks.js';
import { createConversationsRouter } from './routes/conversations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function scheduleBriefing(loop: AgentLoop, config: KoaConfig): void {
  const [hStr, mStr] = (config.briefingTime ?? '08:00').split(':');
  const h = parseInt(hStr ?? '8', 10);
  const m = parseInt(mStr ?? '0', 10);

  function msUntilNext(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function scheduleNext(): void {
    setTimeout(async () => {
      if (config.briefingEnabled) {
        try {
          const text = await buildDailyBriefing();
          void routeResponse('briefing', 'Good morning', text);
        } catch (err) {
          process.stderr.write(`[koa/briefing] error: ${err}\n`);
        }
      }
      scheduleNext(); // reschedule for next day
    }, msUntilNext());
  }

  scheduleNext();
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

  // CORS is only needed in development (Vite runs on a separate port from Express).
  // In production the web UI is served from the same Express origin — no cross-origin calls.
  if (process.env['NODE_ENV'] !== 'production') {
    app.use(cors({ origin: `http://localhost:${devPort}` }));
  }

  // rawBodyMap captures raw request bodies for Slack signature verification and
  // voice transcription. The verify callback fires before express.json() parses
  // the body, giving us access to the original bytes.
  const rawBodyMap = new WeakMap<object, Buffer>();

  app.use(express.json({
    verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
      rawBodyMap.set(req, buf);
    },
  }));
  app.use(express.urlencoded({
    extended: false,
    verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
      rawBodyMap.set(req, buf);
    },
  }));

  // Unauthenticated health check — does not reveal whether auth is configured
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });

  // ── Webhooks (unauthenticated — use channel-specific auth) ────────────────────
  app.use('/webhooks', createWebhooksRouter({ loop, config, rawBodyMap }));

  // Token verification — rate-limited to prevent brute-force.
  // When no token is configured the auth endpoint is unavailable (503) — the
  // server is effectively running without web authentication, not in "open" mode.
  app.post('/api/auth', authRateLimit, (req: Request, res: Response) => {
    const { token } = req.body as { token?: string };
    if (!config.webToken) {
      res.status(503).json({ error: 'Authentication not configured' });
      return;
    }
    if (!token) { res.status(400).json({ error: 'token required' }); return; }
    if (tokenEqual(token, config.webToken)) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'invalid token' });
    }
  });

  // Bearer token auth for all /api/ routes.
  // When a token is configured: enforce Bearer auth (or ?token= query param for SSE).
  // When NO token is configured: deny all /api/ requests with 403 — the server must
  // be explicitly configured before the web interface is accessible.
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!config.webToken) {
      res.status(403).json({ error: 'Web token not configured' });
      return;
    }
    const header = req.headers['authorization'];
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    // Also accept ?token= query param — needed for SSE (GET-only, no custom headers on some clients)
    const queryToken = (req.query as Record<string, string | undefined>)['token'];
    const token = bearerToken ?? queryToken;
    if (!token) { res.status(401).json({ error: 'Authorization required' }); return; }
    if (tokenEqual(token, config.webToken)) { next(); return; }
    res.status(401).json({ error: 'Invalid token' });
  };

  // ── OAuth state (CSRF nonce map) — shared between admin URL builder and callback ──
  const oauthState: OAuthStateMap = new Map();

  // OAuth callback routes bypass requireAuth — Google redirects here without a bearer token.
  // Mount BEFORE the /api/ auth guard so they are reachable unauthenticated.
  app.use('/api/admin', createOAuthCallbackRouter(config, oauthState));

  app.use('/api/', requireAuth);

  // ── Mutable telegramPoller ref — shared between admin router and startup ──────
  let telegramPoller: TelegramPoller | null = null;
  // ── isBusy shared state for the chat router ───────────────────────────────────
  let isBusy = false;

  // ── API routers (all behind the auth guard) ───────────────────────────────────
  app.use('/api/admin', createAdminRouter({
    loop,
    config,
    getTelegramPoller: () => telegramPoller,
    setTelegramPollerRef: (p) => { telegramPoller = p; },
    oauthState,
  }));
  app.use('/api', createChatRouter({
    loop,
    config,
    isBusy: () => isBusy,
    setIsBusy: (v) => { isBusy = v; },
  }));
  app.use('/api', createDbRouter());
  app.use('/api/push', createPushRouter({ loop }));
  app.use('/api/calendar', createCalendarRouter());
  app.use('/api/conversations', createConversationsRouter());
  app.use('/api/voice', createVoiceRouter({ rawBodyMap }));

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

  // ── Background services ────────────────────────────────────────────────────────
  if (config.apiKey) gmailPoller.start(config.apiKey);
  calendarSync.start();
  escalationScheduler.start();

  // Start Telegram polling if bot token is configured
  const startupCreds = readCredentials();
  const telegramToken = startupCreds['TELEGRAM_BOT_TOKEN'];
  if (telegramToken) {
    telegramPoller = new TelegramPoller(telegramToken, loop);
    telegramPoller.start();
    setTelegramPoller(telegramPoller);
  }

  // Daily morning briefing (checks config.briefingEnabled internally)
  scheduleBriefing(loop, config);

  // Check delegations every 5 minutes
  setInterval(() => {
    void runDueDelegations(loop);
  }, 5 * 60_000);

  return { app, getTelegramPoller: () => telegramPoller };
}

export async function startServer(loop: AgentLoop, config: KoaConfig, port: number): Promise<void> {
  const { app } = createServer(loop, config);
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[koa] server listening on port ${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}
