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
  EscalationSettings,
  WebPushSubscription,
  SkillsResponse,
  CustomSkillDef,
  LoadedPlugin,
  Project,
  ProjectStatus,
  Task,
  TaskStatus,
  Decision,
  HealthStatus,
  CalendarEvent,
  CalendarBlock,
  ConflictResult,
  WeeklyReport,
  ForecastSummary,
  ProactiveAlert,
  Conversation,
  ConversationTurn,
  ConversationSearchResult,
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

export async function getSandboxStatus(): Promise<{ available: boolean; backend: string }> {
  const res = await authFetch('/api/admin/sandbox/status');
  if (!res.ok) throw new Error(`Failed to fetch sandbox status: ${res.status}`);
  return res.json() as Promise<{ available: boolean; backend: string }>;
}

export async function getOllamaModels(): Promise<string[]> {
  const res = await authFetch('/api/admin/ollama/models');
  if (!res.ok) throw new Error(`Failed to fetch Ollama models: ${res.status}`);
  const data = (await res.json()) as { models: string[] };
  return data.models;
}

export async function updateAdminConfig(updates: Partial<AdminConfig>): Promise<void> {
  const res = await authFetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update config: ${res.status}`);
}

export async function updateBraveApiKey(value: string): Promise<void> {
  const res = await authFetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ braveApiKey: value }),
  });
  if (!res.ok) throw new Error(`Failed to update Brave API key: ${res.status}`);
}

export async function updateElevenLabsApiKey(value: string): Promise<void> {
  const res = await authFetch('/api/admin/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ elevenLabsApiKey: value }),
  });
  if (!res.ok) throw new Error(`Failed to update ElevenLabs API key: ${res.status}`);
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

export async function startGmailOAuth(): Promise<{ url: string }> {
  const res = await authFetch('/api/admin/oauth/gmail');
  if (!res.ok) throw new Error(`Failed to start Gmail OAuth: ${res.status}`);
  return res.json() as Promise<{ url: string }>;
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

export async function saveEscalationSettings(s: EscalationSettings): Promise<void> {
  const res = await authFetch('/api/admin/notifications/escalation', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(s),
  });
  if (!res.ok) throw new Error(`Failed to save escalation settings: ${res.status}`);
}

export async function fetchVapidKey(): Promise<string> {
  const res = await authFetch('/api/push/vapid-key');
  if (!res.ok) throw new Error(`Failed to fetch VAPID key: ${res.status}`);
  const data = await res.json() as { publicKey: string };
  return data.publicKey;
}

export async function subscribeWebPush(sub: WebPushSubscription): Promise<void> {
  const res = await authFetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  if (!res.ok) throw new Error(`Failed to subscribe to push: ${res.status}`);
}

export async function unsubscribeWebPush(): Promise<void> {
  const res = await authFetch('/api/push/subscribe', { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to unsubscribe: ${res.status}`);
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

export async function fetchPlugins(): Promise<LoadedPlugin[]> {
  const res = await authFetch('/api/admin/plugins');
  if (!res.ok) throw new Error(`Failed to fetch plugins: ${res.status}`);
  return res.json() as Promise<LoadedPlugin[]>;
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
    let doneReceived = false;
    let aborted = false;

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
              doneReceived = true;
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
      if ((err as Error).name === 'AbortError') { aborted = true; return; }
      onError((err as Error).message ?? 'Stream error');
    }

    // Stream closed without a done event (server error, network drop, etc.)
    if (!doneReceived && !aborted) onDone();
  })();

  return () => controller.abort();
}

// ── Health ────────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await authFetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json() as Promise<HealthStatus>;
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function fetchProjects(): Promise<Project[]> {
  const res = await authFetch('/api/projects');
  if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);
  return res.json() as Promise<Project[]>;
}

export async function createProject(name: string, description?: string): Promise<Project> {
  const res = await authFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function updateProject(id: string, updates: { name?: string; description?: string; status?: ProjectStatus }): Promise<Project> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update project: ${res.status}`);
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function archiveProject(id: string): Promise<void> {
  const res = await authFetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to archive project: ${res.status}`);
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export async function fetchTasks(filter?: { projectId?: string; status?: TaskStatus }): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filter?.projectId) params.set('projectId', filter.projectId);
  if (filter?.status) params.set('status', filter.status);
  const qs = params.toString();
  const res = await authFetch(`/api/tasks${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch tasks: ${res.status}`);
  return res.json() as Promise<Task[]>;
}

export async function fetchNextTasks(projectId?: string, limit?: number): Promise<Task[]> {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (limit !== undefined) params.set('limit', String(limit));
  const qs = params.toString();
  const res = await authFetch(`/api/tasks/next${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error(`Failed to fetch next tasks: ${res.status}`);
  return res.json() as Promise<Task[]>;
}

export async function fetchTask(id: string): Promise<Task> {
  const res = await authFetch(`/api/tasks/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`Failed to fetch task: ${res.status}`);
  const data = (await res.json()) as { task: Task };
  return data.task;
}

export async function createTask(
  projectId: string,
  title: string,
  opts?: { description?: string; priority?: number; deadline?: string; effortHours?: number; tags?: string[] },
): Promise<Task> {
  const res = await authFetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, title, ...opts }),
  });
  if (!res.ok) throw new Error(`Failed to create task: ${res.status}`);
  const data = (await res.json()) as { task: Task };
  return data.task;
}

export async function updateTask(
  id: string,
  updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'deadline' | 'effort_hours' | 'actual_hours' | 'tags'>>,
): Promise<Task> {
  const res = await authFetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update task: ${res.status}`);
  const data = (await res.json()) as { task: Task };
  return data.task;
}

export async function deleteTask(id: string): Promise<void> {
  const res = await authFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete task: ${res.status}`);
}

export async function fetchTaskDependencies(id: string): Promise<Task[]> {
  const res = await authFetch(`/api/tasks/${encodeURIComponent(id)}/dependencies`);
  if (!res.ok) throw new Error(`Failed to fetch dependencies: ${res.status}`);
  return res.json() as Promise<Task[]>;
}

export async function addTaskDependency(taskId: string, dependsOnId: string): Promise<void> {
  const res = await authFetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dependsOnId }),
  });
  if (!res.ok) throw new Error(`Failed to add dependency: ${res.status}`);
}

export async function removeTaskDependency(taskId: string, depId: string): Promise<void> {
  const res = await authFetch(`/api/tasks/${encodeURIComponent(taskId)}/dependencies/${encodeURIComponent(depId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to remove dependency: ${res.status}`);
}

// ── Decisions ─────────────────────────────────────────────────────────────────

export async function fetchDecisions(projectId?: string): Promise<Decision[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const res = await authFetch(`/api/decisions${qs}`);
  if (!res.ok) throw new Error(`Failed to fetch decisions: ${res.status}`);
  return res.json() as Promise<Decision[]>;
}

export async function createDecision(d: {
  projectId: string;
  title: string;
  context: string;
  chosen: string;
  rationale: string;
  options?: string[];
}): Promise<Decision> {
  const res = await authFetch('/api/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(d),
  });
  if (!res.ok) throw new Error(`Failed to create decision: ${res.status}`);
  const data = (await res.json()) as { decision: Decision };
  return data.decision;
}

// ── Search ────────────────────────────────────────────────────────────────────

export async function searchItems(query: string, projectId?: string): Promise<Task[]> {
  const params = new URLSearchParams({ q: query });
  if (projectId) params.set('projectId', projectId);
  const res = await authFetch(`/api/search?${params.toString()}`);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json() as Promise<Task[]>;
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export async function fetchCalendarEvents(start: string, end: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ start, end });
  const res = await authFetch(`/api/calendar/events?${params.toString()}`);
  if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`);
  return res.json() as Promise<CalendarEvent[]>;
}

export async function fetchCalendarAvailability(start: string, end: string): Promise<CalendarBlock[]> {
  const params = new URLSearchParams({ start, end });
  const res = await authFetch(`/api/calendar/availability?${params.toString()}`);
  if (!res.ok) throw new Error(`Availability fetch failed: ${res.status}`);
  return res.json() as Promise<CalendarBlock[]>;
}

export async function fetchTaskConflicts(taskId: string): Promise<ConflictResult> {
  const res = await authFetch(`/api/calendar/conflicts?taskId=${encodeURIComponent(taskId)}`);
  if (!res.ok) throw new Error(`Conflict check failed: ${res.status}`);
  return res.json() as Promise<ConflictResult>;
}

export async function triggerCalendarSync(): Promise<void> {
  const res = await authFetch('/api/calendar/sync', { method: 'POST' });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
}

export async function startCalendarOAuth(): Promise<{ url: string }> {
  const res = await authFetch('/api/admin/oauth/calendar');
  if (!res.ok) throw new Error(`OAuth init failed: ${res.status}`);
  return res.json() as Promise<{ url: string }>;
}

// ── Telegram ──────────────────────────────────────────────────────────────────

export async function updateTelegramConfig(config: { botToken?: string; defaultChatId?: string }): Promise<void> {
  const res = await authFetch('/api/admin/telegram', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error(`Failed to update Telegram config: ${res.status}`);
}

export async function getTelegramStatus(): Promise<{ configured: boolean; hasDefaultChatId: boolean; polling: boolean }> {
  const res = await authFetch('/api/admin/telegram');
  if (!res.ok) throw new Error(`Failed to get Telegram status: ${res.status}`);
  return res.json() as Promise<{ configured: boolean; hasDefaultChatId: boolean; polling: boolean }>;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export async function fetchWeeklyReport(): Promise<WeeklyReport> {
  const res = await authFetch('/api/analytics/weekly-report');
  if (!res.ok) throw new Error(`Weekly report fetch failed: ${res.status}`);
  return res.json() as Promise<WeeklyReport>;
}

export async function fetchForecast(): Promise<ForecastSummary> {
  const res = await authFetch('/api/analytics/forecast');
  if (!res.ok) throw new Error(`Forecast fetch failed: ${res.status}`);
  return res.json() as Promise<ForecastSummary>;
}

export async function fetchProactiveAlerts(): Promise<{ alerts: ProactiveAlert[] }> {
  const res = await authFetch('/api/analytics/proactive');
  if (!res.ok) throw new Error(`Proactive alerts fetch failed: ${res.status}`);
  return res.json() as Promise<{ alerts: ProactiveAlert[] }>;
}

// ── Delegations ───────────────────────────────────────────────────────────────

export interface DelegationRecord {
  id: string;
  pattern: string;
  action: string;
  schedule: string;
  last_run: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export async function fetchDelegations(): Promise<DelegationRecord[]> {
  const res = await authFetch('/api/admin/delegations');
  if (!res.ok) throw new Error(`Failed to fetch delegations: ${res.status}`);
  return res.json() as Promise<DelegationRecord[]>;
}

export async function createDelegationApi(data: { pattern: string; action: string; schedule: string }): Promise<DelegationRecord> {
  const res = await authFetch('/api/admin/delegations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to create delegation: ${res.status}`);
  return res.json() as Promise<DelegationRecord>;
}

export async function updateDelegationApi(id: string, updates: Partial<{ action: string; schedule: string; pattern: string; enabled: boolean }>): Promise<DelegationRecord> {
  const res = await authFetch(`/api/admin/delegations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Failed to update delegation: ${res.status}`);
  return res.json() as Promise<DelegationRecord>;
}

export async function deleteDelegationApi(id: string): Promise<void> {
  const res = await authFetch(`/api/admin/delegations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete delegation: ${res.status}`);
}

// ── Conversations ─────────────────────────────────────────────────────────────

export async function fetchConversations(): Promise<Conversation[]> {
  const res = await authFetch('/api/conversations');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json() as Promise<Conversation[]>;
}

export async function fetchConversationTurns(id: string): Promise<ConversationTurn[]> {
  const res = await authFetch(`/api/conversations/${id}/turns`);
  if (!res.ok) throw new Error('Failed to fetch conversation turns');
  return res.json() as Promise<ConversationTurn[]>;
}

export async function exportConversation(id: string, format: 'json' | 'markdown'): Promise<Response> {
  return authFetch(`/api/conversations/${id}/export?format=${format}`);
}

export async function searchConversations(query: string): Promise<ConversationSearchResult[]> {
  const res = await authFetch(`/api/conversations/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Conversation search failed');
  return res.json() as Promise<ConversationSearchResult[]>;
}
