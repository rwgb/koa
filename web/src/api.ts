import type { AdminConfig, AgentStatus, SseEvent } from './types.js';

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
