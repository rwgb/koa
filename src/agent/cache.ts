import crypto from 'crypto';

const TTL_MS = (Number(process.env['KOA_CACHE_TTL_SECONDS'] ?? 60)) * 1000;
const MAX_SIZE = 50;

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class ResponseCache {
  private map = new Map<string, CacheEntry>();

  static key(systemHash: string, userMessage: string): string {
    return crypto.createHash('sha256').update(`${systemHash}:${userMessage}`).digest('hex');
  }

  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // LRU: move to end
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    if (this.map.size >= MAX_SIZE) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + TTL_MS });
  }

  get size(): number {
    return this.map.size;
  }
}
