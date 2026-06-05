import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AgentLoop } from '../../agent/loop.js';
import {
  getPublicVapidKey,
  saveSubscription,
  getSubscription,
  validatePushEndpoint,
} from '../../notifications/webpush.js';
import { saveApnsToken, getApnsToken, isApnsConfigured, sendApnsPush } from '../../notifications/apns.js';

export interface PushRouterDeps {
  loop: AgentLoop;
}

export function createPushRouter(deps: PushRouterDeps): Router {
  const router = Router();
  const { loop } = deps;

  // ── VAPID ─────────────────────────────────────────────────────────────────────

  router.get('/vapid-key', (_req, res) => {
    try {
      res.json({ publicKey: getPublicVapidKey() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ── Web Push ──────────────────────────────────────────────────────────────────

  router.post('/subscribe', (req, res) => {
    const sub = req.body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    if (
      typeof sub.endpoint !== 'string' ||
      typeof sub.keys?.p256dh !== 'string' ||
      typeof sub.keys?.auth !== 'string'
    ) {
      res.status(400).json({ error: 'endpoint, keys.p256dh, and keys.auth are required' });
      return;
    }
    if (!validatePushEndpoint(sub.endpoint)) {
      res.status(400).json({ error: 'endpoint must be an https:// URL from a recognised push service' });
      return;
    }
    const existing = getSubscription();
    if (existing && existing.endpoint !== sub.endpoint) {
      console.warn('[push] subscription replaced — previous endpoint:', existing.endpoint.slice(0, 60));
    }
    saveSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    res.json({ status: 'ok' });
  });

  router.delete('/subscribe', (_req, res) => {
    saveSubscription(null);
    res.json({ status: 'ok' });
  });

  // ── APNs device token (iOS) ───────────────────────────────────────────────────

  router.get('/apns-status', (_req, res) => {
    res.json({
      configured: isApnsConfigured(),
      hasToken: !!getApnsToken(),
      sandbox: process.env['APNS_SANDBOX'] === 'true',
    });
  });

  router.post('/apns-token', (req, res) => {
    const body = req.body as { token?: unknown };
    if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/i.test(body.token)) {
      res.status(400).json({ error: 'token must be a 64-character hex string' });
      return;
    }
    const existing = getApnsToken();
    if (existing && existing !== body.token) {
      console.info('[apns] device token replaced');
    }
    saveApnsToken(body.token);
    res.json({ status: 'ok' });
  });

  router.delete('/apns-token', (_req, res) => {
    saveApnsToken(null);
    res.json({ status: 'ok' });
  });

  // ── Notification reply (process through agent loop, push response back) ───────

  router.post('/reply', (req: Request, res: Response) => {
    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message required' });
      return;
    }
    // Acknowledge immediately — iOS background tasks have tight time limits
    res.status(202).json({ ok: true });

    void (async () => {
      try {
        const result = await loop.turn(message.trim());
        if (result.content) {
          const body = result.content.length > 200
            ? result.content.slice(0, 197) + '…'
            : result.content;
          await sendApnsPush('Koa', body, { category: 'KOA_REPLY' });
        }
      } catch (err) {
        process.stderr.write(`[push/reply] error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    })();
  });

  return router;
}
