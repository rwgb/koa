import crypto from 'crypto';
import { getDb } from '../db/index.js';

export function isDuplicate(channel: string, externalId: string): boolean {
  const db = getDb();
  const row = db.prepare(
    'SELECT 1 FROM processed_messages WHERE channel = ? AND external_id = ?',
  ).get(channel, externalId);
  return row !== undefined;
}

export function markProcessed(
  channel: string,
  externalId: string,
  contentHash: string,
  intent?: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR IGNORE INTO processed_messages (id, channel, external_id, content_hash, intent)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), channel, externalId, contentHash, intent ?? null);
}

export function contentHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
