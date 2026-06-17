import { readCredentials } from '../config/credentials.js'
import { validateSafeUrl } from '../utils/ssrf.js'
import { getGlobalMemoryDb } from '../memory/db.js'
import type { TurnScheduler } from './scheduler.js'

export interface BusEvent {
  type: string                         // namespace.verb e.g. "deploy.failed"
  payload: Record<string, unknown>
}

// Exported so tests can unit-test the matcher without a full EventBus instance.
export function matchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === eventType) return true
  if (pattern.endsWith('.*')) {
    const ns = pattern.slice(0, -2)
    // "deploy.*" matches "deploy.failed" and "deploy.started" but NOT "deployment.done"
    return eventType === ns || eventType.startsWith(ns + '.')
  }
  return false
}

// Module-level singleton — initialized by createServer() after TurnScheduler is built.
let _bus: EventBus | null = null

export function initEventBus(scheduler: TurnScheduler): EventBus {
  _bus = new EventBus(scheduler)
  return _bus
}

export function getEventBus(): EventBus {
  if (!_bus) throw new Error('EventBus not initialized — call initEventBus() first')
  return _bus
}

export class EventBus {
  constructor(private readonly scheduler: TurnScheduler) {}

  async emit(event: BusEvent): Promise<void> {
    const db = getGlobalMemoryDb()
    // Only query standing orders that have a trigger_pattern set
    const rows = db
      .prepare(`SELECT * FROM memory_entries WHERE type = 'standing-order' AND trigger_pattern IS NOT NULL`)
      .all() as Array<{
        id: string
        content: string
        action_type: string | null
        trigger_pattern: string
      }>

    for (const row of rows) {
      if (!matchesPattern(event.type, row.trigger_pattern)) continue
      const actionType = (row.action_type ?? 'notify') as 'notify' | 'brief' | 'agent'
      await this._dispatch(actionType, row.content, event)
    }
  }

  private async _dispatch(
    actionType: 'notify' | 'brief' | 'agent',
    standingOrderContent: string,
    event: BusEvent,
  ): Promise<void> {
    if (actionType === 'agent') {
      // Full agent loop turn — low priority so user turns always preempt it
      const message =
        `[STANDING ORDER TRIGGERED] Event: ${event.type}\n` +
        `Payload: ${JSON.stringify(event.payload, null, 2)}\n\n` +
        `Standing order: ${standingOrderContent}`
      await this.scheduler.enqueue(message, 'low')
      return
    }

    // Both 'notify' and 'brief' fire an ntfy notification.
    // 'brief' is a formatted notification (full Haiku summarization deferred to v1.1
    //  when the provider abstraction supports per-call model overrides).
    const creds = readCredentials()
    const topic = creds['NTFY_TOPIC']
    if (!topic) return
    const baseUrl = creds['NTFY_BASE_URL'] ?? 'https://ntfy.sh'
    try {
      validateSafeUrl(baseUrl)
    } catch {
      return
    }

    const payloadStr = JSON.stringify(event.payload)
    const body =
      actionType === 'brief'
        ? `${standingOrderContent}\n\nEvent: ${event.type}\nPayload: ${payloadStr}`
        : `Event: ${event.type}\nPayload: ${payloadStr}`

    try {
      await fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'Title': `Koa: ${event.type}` },
        body,
      })
    } catch {
      // best-effort; never throw from the bus
    }
  }
}
