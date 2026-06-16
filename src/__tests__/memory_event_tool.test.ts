import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMemoryEventTool } from '../agent/tools/memory_event_tool.js'

// ---------------------------------------------------------------------------
// Mock writeMemoryEvent so tests don't touch the filesystem
// ---------------------------------------------------------------------------

vi.mock('../memory/events.js', () => ({
  writeMemoryEvent: vi.fn().mockReturnValue({
    id: 'mock-id',
    type: 'preference',
    content: 'I prefer dark mode',
    tags: [],
    created_at: new Date().toISOString(),
  }),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMemoryEventTool', () => {
  it('returns an object with name === "write_memory_event"', () => {
    const tool = createMemoryEventTool()
    expect(tool.name).toBe('write_memory_event')
  })

  it('returns a tool with an inputSchema', () => {
    const tool = createMemoryEventTool()
    expect(tool.inputSchema).toBeDefined()
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.required).toContain('type')
    expect(tool.inputSchema.required).toContain('content')
  })

  describe('execute', () => {
    let tool: ReturnType<typeof createMemoryEventTool>

    beforeEach(() => {
      tool = createMemoryEventTool('test-project')
    })

    it('returns a string containing the event type for a preference event', async () => {
      const result = await tool.execute({ type: 'preference', content: 'I prefer dark mode' })
      expect(typeof result).toBe('string')
      expect(result).toContain('preference')
    })

    it('returns a string containing the content preview', async () => {
      const result = await tool.execute({ type: 'preference', content: 'I prefer dark mode' })
      expect(result).toContain('I prefer dark mode')
    })

    it('truncates content longer than 80 characters with an ellipsis', async () => {
      const longContent = 'A'.repeat(90)
      const result = await tool.execute({ type: 'preference', content: longContent }) as string
      expect(result).toContain('…')
      // The preview portion should be 80 chars of 'A' + ellipsis
      expect(result).toContain('A'.repeat(80))
    })

    it('returns an error string when type is missing', async () => {
      const result = await tool.execute({ type: '', content: 'some content' })
      expect(result).toContain('Error')
    })

    it('returns an error string when content is missing', async () => {
      const result = await tool.execute({ type: 'preference', content: '' })
      expect(result).toContain('Error')
    })

    it('accepts tags array', async () => {
      const result = await tool.execute({
        type: 'decision',
        content: 'chose PostgreSQL',
        tags: ['db', 'infra'],
      })
      expect(result).toContain('decision')
    })

    it('accepts action_type and trigger_pattern for standing-order', async () => {
      const result = await tool.execute({
        type: 'standing-order',
        content: 'notify on deploy',
        action_type: 'notify',
        trigger_pattern: 'deploy.*',
      })
      expect(result).toContain('standing-order')
    })
  })
})
