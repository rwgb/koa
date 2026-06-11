import type { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import type { AgentLoop } from '../agent/loop.js';
import type { KoaConfig } from '../config/index.js';
import { buildDailyBriefing } from '../proactive/briefing.js';
import { routeResponse } from '../channels/router.js';
import { tokenEqual } from './utils.js';

// Rate-limiter for the /api/auth token-verification endpoint.
// Prevents brute-force guessing of the web token.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again later' },
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
    // Also accept ?token= query param — needed for SSE (GET-only, no custom headers on some clients)
    const queryToken = (req.query as Record<string, string | undefined>)['token'];
    const token = bearerToken ?? queryToken;
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
