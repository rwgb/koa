// APNs push via Node HTTP/2 (no external dependencies).
//
// Required env vars: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID
// Provide private key via: APNS_KEY_PATH (path to .p8 file)
//                       or APNS_KEY_BASE64 (base64-encoded .p8 contents)
// Optional:            APNS_SANDBOX=true  — use development APNs endpoint
//
// Device tokens (not secrets) are stored in ~/.koa/apns.json (0o600).
import crypto from 'crypto';
import http2 from 'http2';
import fs from 'fs';
import os from 'os';
import path from 'path';

interface ApnsStore {
  deviceToken: string | null;
}

function storePath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'apns.json');
}

function loadStore(): ApnsStore {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8')) as ApnsStore;
  } catch {
    return { deviceToken: null };
  }
}

function saveStore(store: ApnsStore): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function saveApnsToken(token: string | null): void {
  saveStore({ deviceToken: token });
}

export function getApnsToken(): string | null {
  return loadStore().deviceToken;
}

export function isApnsConfigured(): boolean {
  return !!(
    process.env['APNS_KEY_ID'] &&
    process.env['APNS_TEAM_ID'] &&
    process.env['APNS_BUNDLE_ID'] &&
    (process.env['APNS_KEY_PATH'] || process.env['APNS_KEY_BASE64']) &&
    getApnsToken()
  );
}

// Exported for unit testing.
export function makeApnsJwt(teamId: string, keyId: string, privateKey: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: teamId, iat })).toString('base64url');
  const data = `${header}.${payload}`;
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  // IEEE P1363 format (r||s, 64 bytes) required for JWT ES256
  const sig = sign.sign({ key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}

function loadPrivateKey(): string | null {
  const keyPath = process.env['APNS_KEY_PATH'];
  const keyBase64 = process.env['APNS_KEY_BASE64'];
  if (keyPath) {
    try { return fs.readFileSync(keyPath, 'utf8'); } catch { return null; }
  }
  if (keyBase64) {
    try { return Buffer.from(keyBase64, 'base64').toString('utf8'); } catch { return null; }
  }
  return null;
}

export async function sendApnsPush(
  title: string,
  body: string,
  options?: { taskId?: string; category?: string },
): Promise<{ ok: boolean; error?: string }> {
  const keyId = process.env['APNS_KEY_ID'];
  const teamId = process.env['APNS_TEAM_ID'];
  const bundleId = process.env['APNS_BUNDLE_ID'];
  const sandbox = process.env['APNS_SANDBOX'] === 'true';

  if (!keyId || !teamId || !bundleId) return { ok: false, error: 'APNs env vars not set' };

  const privateKey = loadPrivateKey();
  if (!privateKey) return { ok: false, error: 'APNS_KEY_PATH or APNS_KEY_BASE64 required' };

  const token = getApnsToken();
  if (!token) return { ok: false, error: 'no APNs device token registered' };

  let jwt: string;
  try {
    jwt = makeApnsJwt(teamId, keyId, privateKey);
  } catch (e) {
    return { ok: false, error: `JWT signing failed: ${String(e)}` };
  }

  const host = sandbox ? 'api.development.push.apple.com' : 'api.push.apple.com';
  const apnsPayload = JSON.stringify({
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
      ...(options?.taskId ? { 'thread-id': options.taskId } : {}),
      ...(options?.category ? { category: options.category } : {}),
    },
    ...(options?.taskId ? { taskId: options.taskId } : {}),
  });

  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', (e) => {
      resolve({ ok: false, error: String(e) });
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      'apns-push-type': 'alert',
      'apns-topic': bundleId,
      'apns-expiration': '0',
      'apns-priority': '10',
      'authorization': `bearer ${jwt}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(apnsPayload),
    });

    let status = 0;
    let responseData = '';

    req.on('response', (headers) => {
      status = (headers[':status'] as number | undefined) ?? 0;
    });
    req.on('data', (chunk: Buffer) => { responseData += chunk.toString(); });
    req.on('end', () => {
      client.close();
      if (status === 200) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `APNs ${status}: ${responseData}` });
      }
    });
    req.on('error', (e) => {
      client.close();
      resolve({ ok: false, error: String(e) });
    });

    req.write(apnsPayload);
    req.end();
  });
}
