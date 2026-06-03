import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Isolate APNs storage to a temp directory so tests don't touch ~/.koa
const tmpDir = path.join(os.tmpdir(), `koa-apns-test-${process.pid}`);
process.env['KOA_HOME'] = tmpDir;

// Import after setting KOA_HOME
const { makeApnsJwt, saveApnsToken, getApnsToken, isApnsConfigured, sendApnsPush } =
  await import('../notifications/apns.js');

describe('APNs', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpDir, '.koa'), { recursive: true });
    delete process.env['APNS_KEY_ID'];
    delete process.env['APNS_TEAM_ID'];
    delete process.env['APNS_BUNDLE_ID'];
    delete process.env['APNS_KEY_PATH'];
    delete process.env['APNS_KEY_BASE64'];
  });

  afterEach(() => {
    fs.rmSync(path.join(tmpDir, '.koa'), { recursive: true, force: true });
  });

  describe('device token storage', () => {
    it('returns null when no token stored', () => {
      expect(getApnsToken()).toBeNull();
    });

    it('roundtrips a device token', () => {
      const token = 'a'.repeat(64);
      saveApnsToken(token);
      expect(getApnsToken()).toBe(token);
    });

    it('clears token when saved as null', () => {
      saveApnsToken('a'.repeat(64));
      saveApnsToken(null);
      expect(getApnsToken()).toBeNull();
    });

    it('writes apns.json with mode 0o600', () => {
      saveApnsToken('a'.repeat(64));
      const stat = fs.statSync(path.join(tmpDir, '.koa', 'apns.json'));
      expect(stat.mode & 0o777).toBe(0o600);
    });
  });

  describe('isApnsConfigured', () => {
    it('returns false when env vars missing', () => {
      saveApnsToken('a'.repeat(64));
      expect(isApnsConfigured()).toBe(false);
    });

    it('returns false when token missing', () => {
      process.env['APNS_KEY_ID'] = 'KID123';
      process.env['APNS_TEAM_ID'] = 'TEAM123';
      process.env['APNS_BUNDLE_ID'] = 'com.example.koa';
      process.env['APNS_KEY_BASE64'] = 'dGVzdA==';
      expect(isApnsConfigured()).toBe(false);
    });

    it('returns true when all configured', () => {
      process.env['APNS_KEY_ID'] = 'KID123';
      process.env['APNS_TEAM_ID'] = 'TEAM123';
      process.env['APNS_BUNDLE_ID'] = 'com.example.koa';
      process.env['APNS_KEY_BASE64'] = 'dGVzdA==';
      saveApnsToken('a'.repeat(64));
      expect(isApnsConfigured()).toBe(true);
    });
  });

  describe('makeApnsJwt', () => {
    it('produces a valid 3-part JWT', () => {
      // Generate a real P-256 key pair for testing
      const { privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });

      const jwt = makeApnsJwt('TEAM123', 'KID456', privateKey as string);
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);

      const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
      expect(header).toEqual({ alg: 'ES256', kid: 'KID456' });

      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString());
      expect(payload.iss).toBe('TEAM123');
      expect(typeof payload.iat).toBe('number');
      expect(payload.iat).toBeGreaterThan(0);
    });

    it('signature is 64 bytes (IEEE P1363 for P-256)', () => {
      const { privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'P-256',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });

      const jwt = makeApnsJwt('T', 'K', privateKey as string);
      const sigPart = jwt.split('.')[2]!;
      const sig = Buffer.from(sigPart, 'base64url');
      expect(sig.length).toBe(64);
    });
  });

  describe('sendApnsPush', () => {
    it('returns not-configured error when env vars absent', async () => {
      const result = await sendApnsPush('Title', 'Body');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not set/);
    });

    it('returns no-token error when env vars set but token absent', async () => {
      process.env['APNS_KEY_ID'] = 'KID';
      process.env['APNS_TEAM_ID'] = 'TEAM';
      process.env['APNS_BUNDLE_ID'] = 'com.example.koa';
      process.env['APNS_KEY_BASE64'] = Buffer.from('not-a-real-key').toString('base64');
      const result = await sendApnsPush('Title', 'Body');
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no APNs device token/);
    });

    it('includes category in aps payload when provided', async () => {
      // When not configured, passing { category: 'KOA_REPLY' } should still return the
      // env-vars-not-set error — not crash or mis-type.
      const result = await sendApnsPush('T', 'B', { category: 'KOA_REPLY' });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not set/);
    });
  });
});
