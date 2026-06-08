import { describe, it, expect } from 'vitest';
import { isOllamaUrl } from '../utils/ollama_url.js';

describe('isOllamaUrl', () => {
  // ── Allowed: loopback ────────────────────────────────────────────────────────

  it('allows localhost', () => {
    expect(isOllamaUrl('http://localhost:11434')).toBe(true);
  });

  it('allows 127.0.0.1', () => {
    expect(isOllamaUrl('http://127.0.0.1:11434')).toBe(true);
  });

  // ── Allowed: RFC1918 private ranges ──────────────────────────────────────────

  it('allows 192.168.x.x private address', () => {
    expect(isOllamaUrl('http://192.168.1.201:11434')).toBe(true);
  });

  it('allows 10.x.x.x private address', () => {
    expect(isOllamaUrl('http://10.0.0.5:11434')).toBe(true);
  });

  it('allows 172.16.x.x private address', () => {
    expect(isOllamaUrl('http://172.16.0.1:11434')).toBe(true);
  });

  // ── Rejected: public / non-private addresses ─────────────────────────────────

  it('rejects a public domain', () => {
    expect(isOllamaUrl('https://evil.com/ollama')).toBe(false);
  });

  it('rejects a public IP address', () => {
    expect(isOllamaUrl('http://8.8.8.8:11434')).toBe(false);
  });

  it('rejects link-local 169.254.x.x', () => {
    expect(isOllamaUrl('http://169.254.0.1:11434')).toBe(false);
  });
});
