import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import { buildDailyBriefing } from '../proactive/briefing.js';
import { routeResponse } from '../channels/router.js';
import { tokenEqual } from './utils.js';
import { consumeTicket } from './auth-ticket.js';

// Rate-limiter for the /api/auth token-verification endpoint.
// Prevents brute-force guessing of the web token.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later' },
});

// Rate-limiter for POST /api/chat and GET /api/sse/chat.
// Caps conversational throughput to prevent runaway agent costs.
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded — try again later' },
});

// Rate-limiter for POST /api/voice/tts (text-to-speech synthesis).
// TTS is more expensive per-request than chat; tighter limit prevents cost abuse.
export const voiceRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded — try again later' },
});

// Rate-limiter for PUT /api/admin/config and POST /api/admin/update.
// Destructive/expensive admin mutations should be rare; very tight window prevents
// accidental or malicious rapid config churn or repeated update triggers.
export const adminUpdateRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 2,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded — try again later' },
});

// Bearer token guard for all /api/ routes.
// When a token is configured: enforce Bearer auth (or ?token= query param for SSE).
// When NO token is configured: deny all /api/ requests with 403 — the server must
// be explicitly configured before the web interface is accessible.
export function requireAuth(config: KoaConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.webToken) {
      res.status(403).json({ error: 'Web token not configured' });
      return;
    }
    const header = req.headers['authorization'];
    const bearerToken = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const query = req.query as Record<string, string | undefined>;
    // ?ticket= — one-time short-lived SSE ticket (preferred; avoids long-lived token in URL)
    const ticketParam = query['ticket'];
    const ticketToken = ticketParam ? consumeTicket(ticketParam) : null;
    // TODO: deprecate ?token= once all clients use ticket auth
    const queryToken = query['token'];
    const token = bearerToken ?? ticketToken ?? queryToken;
    if (!token) { res.status(401).json({ error: 'Authorization required' }); return; }
    if (tokenEqual(token, config.webToken)) { next(); return; }
    res.status(401).json({ error: 'Invalid token' });
  };
}

// Schedules the daily morning briefing based on config.briefingTime (default 08:00).
// Fires each day at the configured hour; re-schedules itself automatically.
export function scheduleBriefing(loop: AgentLoop, config: KoaConfig): void {
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
