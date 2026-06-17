import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { matchesPattern, EventBus } from '../agent/event-bus.js'
import type { TurnScheduler } from '../agent/scheduler.js'

// ── Module mocks (hoisted by vitest) ──────────────────────────────────────────

// Mutable holder so individual tests can replace the rows returned.
let mockRows: unknown[] = []

vi.mock('../memory/db.js', () => ({
  getGlobalMemoryDb: () => ({
    prepare: () => ({ all: () => mockRows }),
  }),
}))

// Mutable holder so individual tests can control credentials.
let mockCreds: Record<string, string> = {}

vi.mock('../config/credentials.js', () => ({
  readCredentials: () => mockCreds,
}))

// validateSafeUrl: let tests control whether it throws.
let ssrfShouldThrow = false

vi.mock('../utils/ssrf.js', () => ({
  validateSafeUrl: (_url: string) => {
    if (ssrfShouldThrow) throw new Error('SSRF blocked')
  },
}))

// ── matchesPattern ─────────────────────────────────────────────────────────────
describe('matchesPattern', () => {
  it('exact match', () => expect(matchesPattern('deploy.failed', 'deploy.failed')).toBe(true))
  it('wildcard match same namespace', () => expect(matchesPattern('deploy.started', 'deploy.*')).toBe(true))
  it('wildcard does not bleed into adjacent namespace', () => {
    expect(matchesPattern('deployment.done', 'deploy.*')).toBe(false)
  })
  it('wildcard matches bare namespace', () => expect(matchesPattern('deploy', 'deploy.*')).toBe(true))
  it('no match', () => expect(matchesPattern('task.blocked', 'deploy.*')).toBe(false))
  it('exact mismatch', () => expect(matchesPattern('deploy.failed', 'deploy.started')).toBe(false))
})

// ── EventBus.emit ──────────────────────────────────────────────────────────────
describe('EventBus.emit', () => {
  let mockScheduler: TurnScheduler
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockRows = []
    mockCreds = {}
    ssrfShouldThrow = false
    mockScheduler = { enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as TurnScheduler
    fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('no-ops when no standing orders match', async () => {
    mockRows = []
    const bus = new EventBus(mockScheduler)
    await bus.emit({ type: 'deploy.failed', payload: { env: 'prod' } })
    expect(mockScheduler.enqueue).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('dispatches notify action via ntfy', async () => {
    mockRows = [{
      id: '1', content: 'alert on deploy failure', action_type: 'notify', trigger_pattern: 'deploy.*',
    }]
    mockCreds = { NTFY_TOPIC: 'test-topic', NTFY_BASE_URL: 'https://ntfy.sh' }
    const bus = new EventBus(mockScheduler)
    await bus.emit({ type: 'deploy.failed', payload: { env: 'prod' } })
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(mockScheduler.enqueue).not.toHaveBeenCalled()
  })

  it('dispatches agent action via scheduler', async () => {
    mockRows = [{
      id: '2', content: 'investigate deploy failures', action_type: 'agent', trigger_pattern: 'deploy.failed',
    }]
    const bus = new EventBus(mockScheduler)
    await bus.emit({ type: 'deploy.failed', payload: { env: 'prod' } })
    expect(mockScheduler.enqueue).toHaveBeenCalledOnce()
    const call = (mockScheduler.enqueue as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    const [msg, priority] = call
    expect(msg).toContain('[STANDING ORDER TRIGGERED]')
    expect(msg).toContain('deploy.failed')
    expect(priority).toBe('low')
  })

  it('skips ntfy when NTFY_TOPIC not configured', async () => {
    mockRows = [{
      id: '3', content: 'notify on task block', action_type: 'notify', trigger_pattern: 'task.*',
    }]
    mockCreds = {}
    const bus = new EventBus(mockScheduler)
    await bus.emit({ type: 'task.blocked', payload: {} })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
