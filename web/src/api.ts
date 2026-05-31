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
} from './types.js';

export async function fetchStatus(): Promise<AgentStatus> {
  const res = await fetch('/api/context');
  if (!res.ok) {
    throw new Error(`Failed to fetch status: ${res.status}`);
  }
  return res.json() as Promise<AgentStatus>;
}

export async function fetchAdminConfig(): Promise<AdminConfig> {
  const res = await fetch('/api/admin/config');
  if (!res.ok) throw new Error(`Failed to fetch config: ${res.status}`);
  return res.json() as Promise<AdminConfig>;
}

export async function fetchMemoryEngram(): Promise<EngramMemoryResponse> {
  const res = await fetch('/api/admin/memory/engram');
  if (!res.ok) throw new Error(`Failed to fetch engram: ${res.status}`);
  return res.json() as Promise<EngramMemoryResponse>;
}

export async function fetchMemoryFiles(): Promise<MemoryFilesResponse> {
  const res = await fetch('/api/admin/memory/files');
  if (!res.ok) throw new Error(`Failed to fetch memory files: ${res.status}`);
  return res.json() as Promise<MemoryFilesResponse>;
}

export async function updateMemoryFile(file: string, content: string): Promise<void> {
  const res = await fetch(`/api/admin/memory/files/${file}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
}

export async function fetchFacts(): Promise<MemoryEntry[]> {
  const res = await fetch('/api/admin/memory/facts');
  if (!res.ok) throw new Error(`Failed to fetch facts: ${res.status}`);
  const data = (await res.json()) as { facts: MemoryEntry[] };
  return data.facts;
}

export async function addFact(fact: string): Promise<void> {
  const res = await fetch('/api/admin/memory/facts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fact }),
  });
  if (!res.ok) throw new Error(`Failed to add fact: ${res.status}`);
}

export async function deleteFact(fact: string): Promise<void> {
  const res = await fetch('/api/admin/memory/facts', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fact }),
  });
  if (!res.ok) throw new Error(`Failed to delete fact: ${res.status}`);
}

export async function rebuildBrain(): Promise<string> {
  const res = await fetch('/api/admin/brain/rebuild', { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to rebuild brain: ${res.status}`);
  const data = (await res.json()) as { output?: string };
  return data.output ?? '';
}

export async function fetchActivitySessions(): Promise<ActivitySessionsResponse> {
  const res = await fetch('/api/admin/activity/sessions');
  if (!res.ok) throw new Error(`Failed to fetch sessions: ${res.status}`);
  return res.json() as Promise<ActivitySessionsResponse>;
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function updateAdminConfig(updates: Partial<AdminConfig>): Promise<void> {
  const res = await fetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
}

// ── Integrations ──────────────────────────────────────────────────────────────

export async function fetchIntegrations(): Promise<Integration[]> {
  const res = await fetch('/api/admin/integrations');
  if (!res.ok) throw new Error(`Failed to fetch integrations: ${res.status}`);
  const data = (await res.json()) as { integrations: Integration[] };
  return data.integrations;
}

export async function saveIntegration(id: string, payload: {
  type: string;
  name: string;
  config: Record<string, string>;
}): Promise<Integration> {
  const res = await fetch(`/api/admin/integrations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to save integration: ${res.status}`);
  const data = (await res.json()) as { integration: Integration };
  return data.integration;
}

export async function deleteIntegration(id: string): Promise<void> {
  const res = await fetch(`/api/admin/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete integration: ${res.status}`);
}

export async function testIntegration(id: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`/api/admin/integrations/${encodeURIComponent(id)}/test`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to test integration: ${res.status}`);
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await fetch('/api/admin/notifications');
  if (!res.ok) throw new Error(`Failed to fetch notifications: ${res.status}`);
  return res.json() as Promise<NotificationsResponse>;
}

export async function saveNotificationRules(rules: NotificationRule[]): Promise<void> {
  const res = await fetch('/api/admin/notifications/rules', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  });
  if (!res.ok) throw new Error(`Failed to save rules: ${res.status}`);
}

export async function saveQuietHours(qh: QuietHours): Promise<void> {
  const res = await fetch('/api/admin/notifications/quiet-hours', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(qh),
  });
  if (!res.ok) throw new Error(`Failed to save quiet hours: ${res.status}`);
}

export async function testNotification(channel: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/admin/notifications/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel }),
  });
  if (!res.ok) throw new Error(`Failed to send test: ${res.status}`);
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      onError((err as Error).message ?? 'Network error');
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

        // SSE messages are separated by double newlines
        const parts = buffer.split('\n\n');
        // Keep the last (possibly incomplete) chunk in the buffer
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
