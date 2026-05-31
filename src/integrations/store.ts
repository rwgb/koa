import fs from 'fs';
import os from 'os';
import path from 'path';

export interface Integration {
  id: string;
  type: string;
  name: string;
  status: 'connected' | 'not_configured' | 'error';
  config: Record<string, string>;
  errorMsg?: string;
}

// Secret fields by integration type — values are masked in API responses
export const SECRET_FIELDS: Record<string, string[]> = {
  anthropic: ['apiKey'],
  github: ['token'],
  slack: ['webhookUrl', 'botToken'],
  pushover: ['userKey', 'appToken'],
  ntfy: [],
  smtp: ['password'],
  homelab: ['token'],
  eset: ['apiKey'],
  custom_http: ['authValue'],
  mcp_server: ['authToken'],
};

export const ALLOWED_TYPES = new Set(Object.keys(SECRET_FIELDS));

function integrationsPath(): string {
  return path.join(process.env['KOA_HOME'] ?? os.homedir(), '.koa', 'integrations.json');
}

export function loadIntegrations(): Integration[] {
  try {
    const raw = fs.readFileSync(integrationsPath(), 'utf8');
    return JSON.parse(raw) as Integration[];
  } catch {
    return [];
  }
}

export function maskSecrets(integration: Integration): Integration {
  const secrets = SECRET_FIELDS[integration.type] ?? [];
  const masked: Record<string, string> = { ...integration.config };
  for (const field of secrets) {
    if (masked[field]) masked[field] = '***';
  }
  return { ...integration, config: masked };
}

// Merges submitted config with existing stored config, preserving secrets when value is '***'
export function mergeConfig(
  existing: Record<string, string>,
  submitted: Record<string, string>,
  type: string,
): Record<string, string> {
  const secrets = new Set(SECRET_FIELDS[type] ?? []);
  const merged: Record<string, string> = { ...existing };
  for (const [key, val] of Object.entries(submitted)) {
    if (secrets.has(key) && val === '***') continue;
    merged[key] = val;
  }
  return merged;
}

export function saveIntegration(integration: Integration): void {
  const all = loadIntegrations();
  const idx = all.findIndex(i => i.id === integration.id);
  if (idx >= 0) {
    all[idx] = integration;
  } else {
    all.push(integration);
  }
  const p = integrationsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(all, null, 2), { mode: 0o600 });
}

export function deleteIntegration(id: string): boolean {
  const all = loadIntegrations();
  const filtered = all.filter(i => i.id !== id);
  if (filtered.length === all.length) return false;
  const p = integrationsPath();
  fs.writeFileSync(p, JSON.stringify(filtered, null, 2), { mode: 0o600 });
  return true;
}

// Sends a notification via the configured ntfy integration. No-ops silently if not configured.
export async function sendNtfyNotification(title: string, body: string): Promise<void> {
  const integration = loadIntegrations().find(i => i.type === 'ntfy' && i.status === 'connected');
  if (!integration) return;
  const topic = integration.config['topic'];
  const baseUrl = integration.config['baseUrl'] || 'https://ntfy.sh';
  if (!topic) return;
  await fetch(`${baseUrl}/${topic}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'Title': title },
    body,
  });
}
