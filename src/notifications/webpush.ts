// NOTE: Web Push requires HTTPS in production. On localhost, Firefox allows HTTP push
// endpoints; Chrome requires HTTPS even for localhost (service workers exception does not
// extend to push subscriptions). For prod behind a reverse proxy, trust X-Forwarded-Proto.
//
// NOTE: ~/.koa/vapid.json (mode 0o600) stores the VAPID private key in plain JSON.
// Exclude this file from backups, cloud sync, and dotfile repos.
import webpush from 'web-push';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { URL } from 'url';

// Allowlist of known push service origins — guards against stored SSRF.
const ALLOWED_PUSH_ORIGINS = [
  'https://fcm.googleapis.com',
  'https://updates.push.services.mozilla.com',
  'https://push.apple.com',
  'https://wns2.windows.com',
  'https://notify.windows.com',
];

export function validatePushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_PUSH_ORIGINS.some(o => endpoint.startsWith(o));
  } catch { return false; }
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface WebPushStore {
  vapid: VapidKeys;
  subscription: PushSubscription | null;
}

function storePath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'vapid.json');
}

function loadStore(): WebPushStore {
  try {
    return JSON.parse(fs.readFileSync(storePath(), 'utf8')) as WebPushStore;
  } catch {
    const vapid = webpush.generateVAPIDKeys();
    const store: WebPushStore = { vapid, subscription: null };
    const p = storePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
    return store;
  }
}

function saveStore(store: WebPushStore): void {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function getPublicVapidKey(): string {
  return loadStore().vapid.publicKey;
}

export function saveSubscription(sub: PushSubscription | null): void {
  const store = loadStore();
  store.subscription = sub;
  saveStore(store);
}

export function getSubscription(): PushSubscription | null {
  return loadStore().subscription;
}

export async function sendWebPush(title: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const store = loadStore();
  if (!store.subscription) return { ok: false, error: 'no subscriber' };

  webpush.setVapidDetails('mailto:koa@localhost', store.vapid.publicKey, store.vapid.privateKey);

  try {
    await webpush.sendNotification(store.subscription, JSON.stringify({ title, body }));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
