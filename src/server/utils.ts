import crypto from 'crypto';
import type { Response } from 'express';

// Safe error responder for DB endpoints — logs full error server-side, returns a sanitised message.
export function dbError(res: Response, e: unknown): void {
  console.error('[koa/db]', e);
  res.status(500).json({ error: 'Internal server error' });
}

// Constant-time token comparison: HMAC both values to a fixed length before comparing,
// eliminating the length oracle that padding-based approaches suffer from.
export function tokenEqual(a: string, b: string): boolean {
  const key = 'koa-token-verify';
  const ha = crypto.createHmac('sha256', key).update(a).digest();
  const hb = crypto.createHmac('sha256', key).update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
