import { describe, it, expect } from 'vitest';
import { validateSafeUrl } from '../utils/ssrf.js';

describe('validateSafeUrl', () => {
  // ── Valid public URLs ─────────────────────────────────────────────────────────

  it('allows a valid HTTPS public URL', () => {
    expect(() => validateSafeUrl('https://example.com')).not.toThrow();
  });

  it('allows a valid HTTPS URL with path and query', () => {
    expect(() => validateSafeUrl('https://api.example.com/v1/data?foo=bar')).not.toThrow();
  });

  // ── Protocol enforcement ──────────────────────────────────────────────────────

  it('rejects http:// URLs', () => {
    expect(() => validateSafeUrl('http://example.com')).toThrow(/HTTPS/i);
  });

  it('rejects ftp:// URLs', () => {
    expect(() => validateSafeUrl('ftp://example.com')).toThrow(/HTTPS/i);
  });

  // ── Localhost / loopback ──────────────────────────────────────────────────────

  it('rejects localhost', () => {
    expect(() => validateSafeUrl('https://localhost/foo')).toThrow(/private|loopback/i);
  });

  it('rejects 127.0.0.1', () => {
    expect(() => validateSafeUrl('https://127.0.0.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 127.0.0.2', () => {
    expect(() => validateSafeUrl('https://127.0.0.2/')).toThrow(/private|loopback/i);
  });

  it('rejects 0.0.0.0', () => {
    expect(() => validateSafeUrl('https://0.0.0.0/')).toThrow(/private|loopback/i);
  });

  // ── Private IPv4 ranges ───────────────────────────────────────────────────────

  it('rejects 10.x private address', () => {
    expect(() => validateSafeUrl('https://10.0.0.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 10.255.255.255', () => {
    expect(() => validateSafeUrl('https://10.255.255.255/')).toThrow(/private|loopback/i);
  });

  it('rejects 192.168.x.x private address', () => {
    expect(() => validateSafeUrl('https://192.168.1.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 172.16.x.x private address', () => {
    expect(() => validateSafeUrl('https://172.16.0.1/')).toThrow(/private|loopback/i);
  });

  it('rejects 172.31.x.x private address', () => {
    expect(() => validateSafeUrl('https://172.31.255.255/')).toThrow(/private|loopback/i);
  });

  it('allows 172.15.x.x (just below private range)', () => {
    expect(() => validateSafeUrl('https://172.15.0.1/')).not.toThrow();
  });

  it('allows 172.32.x.x (just above private range)', () => {
    expect(() => validateSafeUrl('https://172.32.0.1/')).not.toThrow();
  });

  // ── AWS metadata / link-local ─────────────────────────────────────────────────

  it('rejects AWS metadata endpoint 169.254.169.254', () => {
    expect(() => validateSafeUrl('https://169.254.169.254/')).toThrow(/private|loopback/i);
  });

  it('rejects link-local 169.254.x.x', () => {
    expect(() => validateSafeUrl('https://169.254.0.1/')).toThrow(/private|loopback/i);
  });

  // ── Invalid URLs ──────────────────────────────────────────────────────────────

  it('rejects malformed URLs', () => {
    expect(() => validateSafeUrl('not-a-url')).toThrow(/Invalid URL/i);
  });

  it('rejects empty string', () => {
    expect(() => validateSafeUrl('')).toThrow();
  });

  // ── Custom hostname validator ─────────────────────────────────────────────────

  it('allows URL when extraHostCheck passes', () => {
    expect(() =>
      validateSafeUrl('https://hooks.slack.com/foo', (h) => h === 'hooks.slack.com'),
    ).not.toThrow();
  });

  it('rejects URL when extraHostCheck fails', () => {
    expect(() =>
      validateSafeUrl('https://example.com/foo', (h) => h === 'hooks.slack.com'),
    ).toThrow(/not permitted/i);
  });

  // ── IPv6 private / loopback ───────────────────────────────────────────────────

  it('rejects IPv6 loopback [::1]', () => {
    expect(() => validateSafeUrl('https://[::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv6 loopback full form [0:0:0:0:0:0:0:1]', () => {
    expect(() => validateSafeUrl('https://[0:0:0:0:0:0:0:1]/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv6 ULA [fc00::1]', () => {
    expect(() => validateSafeUrl('https://[fc00::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv6 ULA [fd12::1]', () => {
    expect(() => validateSafeUrl('https://[fd12::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv6 link-local [fe80::1]', () => {
    expect(() => validateSafeUrl('https://[fe80::1]/')).toThrow(/private|loopback/i);
  });

  it('rejects IPv4-mapped IPv6 loopback [::ffff:127.0.0.1]', () => {
    expect(() => validateSafeUrl('https://[::ffff:127.0.0.1]/')).toThrow(/private|loopback/i);
  });

  it('allows public IPv6 address [2606:4700:4700::1111]', () => {
    expect(() => validateSafeUrl('https://[2606:4700:4700::1111]/')).not.toThrow();
  });
});
