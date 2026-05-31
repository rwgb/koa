import type {
  AdminConfig,
  AgentStatus,
  SseEvent,
  MemoryEntry,
  MemoryFilesResponse,
  EngramMemoryResponse,
  ActivitySessionsResponse,
  Integration,
  NotificationsResponse,
  NotificationRule,
  QuietHours,
  SkillsResponse,
  CustomSkillDef,
} from './types.js';

// ── Token storage ─────────────────────────────────────────────────────────────

const TOKEN_KEY = 'koa_web_token';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ── Auth fetch wrapper ────────────────────────────────────────────────────────

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getStoredToken();
  return token
    ? { ...extra, 'Authorization': `Bearer ${token}` }
    : extra;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders(init.headers as Record<string, string> ?? {}), ...(init.headers ?? {}) },
  });
  return res;
}

// ── Auth API ──────────────────────────────────────────────────────────────────

// Ping the server and determine if auth is required by probing /api/context.
// /api/ping is unauthenticated but no longer advertises auth status — we infer
// it by checking whether /api/context returns 401.
export async function pingServer(): Promise<{ ok: boolean; auth: boolean }> {
  const probe = await fetch('/api/context');
  if (probe.status === 401) return { ok: true, auth: true };
  if (probe.ok) return { ok: true, auth: false };
  // Server error or unreachable — treat as no auth so the app still loads
  return { ok: false, auth: false };
}

export async function verifyToken(token: string): Promise<boolean> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

// ── Core API ──────────────────────────────────────────────────────────────────

export async function fetchStatus(): Promise<AgentStatus> {
  const res = await authFetch('/api/context');
  if (!res.ok) throw new Error(`Failed to fetch status: ${res.status}`);
  return res.json() as Promise<AgentStatus>;
}

export async function fetchAdminConfig(): Promise<AdminConfig> {
  const res = await authFetch('/api/admin/config');
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json() as Promise<AdminConfig>;
}

export async function fetchMemoryEngram(): Promise<EngramMemoryResponse> {
  const res = await authFetch('/api/admin/memory/engram');
  if (!res.ok) throw new Error(`Failed to fetch engram: ${res.status}`);
  return res.json() as Promise<EngramMemoryResponse>;
}

export async function fetchMemoryFiles(): Promise<MemoryFilesResponse> {
  const res = await authFetch('/api/admin/memory/files');
  if (!res.ok) throw new Error(`Failed to fetch memory files: ${res.status}`);
  return res.json() as Promise<MemoryFilesResponse>;
}

export async function updateMemoryFile(file: string, content: string): Promise<void> {
  const res = await authFetch(`/api/admin/memory/files/${file}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
}

export async function fetchFacts(): Promise<MemoryEntry[]> {
  const res = await authFetch('/api/admin/memory/facts');
  if (!res.ok) throw new Error(`Failed to fetch facts: ${res.status}`);
  const data = (await res.json()) as { facts: MemoryEntry[] };
  return data.facts;
}

export async function addFact(fact: string): Promise<void> {
  const res = await authFetch('/api/admin/memory/facts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fact }),
  });
  if (!res.ok) throw new Error(`Failed to add fact: ${res.status}`);
}

export async function deleteFact(fact: string): Promise<void> {
  const res = await authFetch('/api/admin/memory/facts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fact }),
  });
  if (!res.ok) throw new Error(`Failed to delete fact: ${res.status}`);
}

export async function rebuildBrain(): Promise<string> {
  const res = await authFetch('/api/admin/brain/rebuild', { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to rebuild brain: ${res.status}`);
  const data = (await res.json()) as { output?: string };
  return data.output ?? '';
}

export async function fetchActivitySessions(): Promise<ActivitySessionsResponse> {
  const res = await authFetch('/api/admin/activity/sessions');
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json() as Promise<ActivitySessionsResponse>;
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function updateAdminConfig(updates: Partial<AdminConfig>): Promise<void> {
  const res = await authFetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
}

// ── Integrations ──────────────────────────────────────────────────────────────

export async function fetchIntegrations(): Promise<Integration[]> {
  const res = await authFetch('/api/admin/integrations');
  if (!res.ok) throw new Error(`Failed to fetch integrations: ${res.status}`);
  const data = (await res.json()) as { integrations: Integration[] };
  return data.integrations;
}

export async function saveIntegration(id: string, payload: {
  type: string;
  name: string;
  config: Record<string, string>;
}): Promise<Integration> {
  const res = await authFetch(`/api/admin/integrations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to save integration: ${res.status}`);
  const data = (await res.json()) as { integration: Integration };
  return data.integration;
}

export async function deleteIntegration(id: string): Promise<void> {
  const res = await authFetch(`/api/admin/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete integration: ${res.status}`);
}

export async function testIntegration(id: string): Promise<{ ok: boolean; message: string }> {
  const res = await authFetch(`/api/admin/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to test integration: ${res.status}`);
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await authFetch('/api/admin/notifications');
  if (!res.ok) throw new Error(`Failed to fetch notifications: ${res.status}`);
  return res.json() as Promise<NotificationsResponse>;
}

export async function saveNotificationRules(rules: NotificationRule[]): Promise<void> {
  const res = await authFetch('/api/admin/notifications/rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(`Failed to save rules: ${res.status}`);
}

export async function saveQuietHours(qh: QuietHours): Promise<void> {
  const res = await authFetch('/api/admin/notifications/quiet-hours', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(qh),
  });
  if (!res.ok) throw new Error(`Failed to save quiet hours: ${res.status}`);
}

export async function testNotification(channel: string): Promise<{ ok: boolean; message: string }> {
  const res = await authFetch('/api/admin/notifications/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  });
  if (!res.ok) throw new Error(`Failed to send test: ${res.status}`);
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

// ── Skills ────────────────────────────────────────────────────────────────────

export async function fetchSkills(): Promise<SkillsResponse> {
  const res = await authFetch('/api/admin/skills');
  if (!res.ok) throw new Error(`Failed to fetch skills: ${res.status}`);
  return res.json() as Promise<SkillsResponse>;
}

export async function saveCustomSkill(skill: CustomSkillDef): Promise<void> {
  const res = await authFetch('/api/admin/skills/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(skill),
  });
  if (!res.ok) throw new Error(`Failed to save skill: ${res.status}`);
}

export async function deleteCustomSkill(name: string): Promise<void> {
  const res = await authFetch(`/api/admin/skills/custom/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`Failed to delete skill: ${res.status}`);
}

// ── Chat (SSE) ────────────────────────────────────────────────────────────────

export function streamChat(
  message: string,
  onEvent: (e: SseEvent) => void,
  onDone: () => void,
  onError: (msg: string) => void,
): () => void {
  const controller = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onError((err as Error).message ?? 'Network error');
      return;
    }

    if (res.status === 401) {
      onError('Authentication required — please re-enter your token');
      return;
    }

    if (res.status === 429) {
      try {
        const body = (await res.json()) as { error?: string };
        onError(body.error ?? 'Agent is busy');
      } catch {
        onError('Agent is busy');
      }
      return;
    }

    if (!res.ok) {
      onError(`Server error: ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError('No response body');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice('data: '.length);
          try {
            const event = JSON.parse(jsonStr) as SseEvent;
            if (event.type === 'done') {
              onEvent(event);
              onDone();
            } else {
              onEvent(event);
            }
          } catch {
            // Malformed JSON — skip silently
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onError((err as Error).message ?? 'Stream error');
    }
  })();

  return () => controller.abort();
}
