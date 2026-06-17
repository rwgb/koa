import { writeMemoryEvent } from '../../memory/events.js';
import type { MemoryEventType, NewMemoryEntry } from '../../memory/schema.js';
import { GLOBAL_TYPES, PROJECT_TYPES } from '../../memory/schema.js';
import type { Tool } from '../../types/index.js';

const VALID_TYPES: ReadonlySet<string> = new Set([...GLOBAL_TYPES, ...PROJECT_TYPES]);
const CONTENT_MAX_LENGTH = 4000;

export function createMemoryEventTool(slug?: string): Tool {
  return {
    name: 'write_memory_event',
    description:
      'Write a typed learning event to long-term memory. Use for preferences, decisions, corrections, standing orders, boundaries, and facts to remember across sessions. ' +
      'Global types (preference, standing-order, boundary, assertion, correction) persist across all projects. ' +
      'Project types (decision, failure, journal) are project-scoped.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'preference',
            'standing-order',
            'boundary',
            'assertion',
            'correction',
            'decision',
            'failure',
            'journal',
          ],
        },
        content: {
          type: 'string',
          description: 'The fact, preference, or instruction to remember.',
        },
        action_type: {
          type: 'string',
          enum: ['notify', 'brief', 'agent'],
          description: 'Required for standing-order. How to act when triggered.',
        },
        trigger_pattern: {
          type: 'string',
          description: 'For standing-order: event bus topic pattern e.g. "deploy.*"',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['type', 'content'],
    },
    execute: async (input: Record<string, unknown>) => {
      const type = String(input['type'] ?? '').trim() as MemoryEventType;
      const content = String(input['content'] ?? '').trim().slice(0, CONTENT_MAX_LENGTH);

      if (!type) return 'Error: type is required.';
      if (!VALID_TYPES.has(type)) {
        return `Error: invalid type "${type}". Must be one of: ${[...VALID_TYPES].join(', ')}.`;
      }
      if (!content) return 'Error: content is required.';

      const entry: NewMemoryEntry = {
        type,
        content,
        tags: Array.isArray(input['tags'])
          ? (input['tags'] as unknown[]).map(String)
          : [],
      };

      if (input['action_type'] != null) {
        entry.action_type = input['action_type'] as 'notify' | 'brief' | 'agent';
      }
      if (input['trigger_pattern'] != null) {
        entry.trigger_pattern = String(input['trigger_pattern']);
      }

      writeMemoryEvent(entry, slug);

      const preview = content.length > 80 ? content.slice(0, 80) + '…' : content;
      return `Remembered: ${type} — ${preview}`;
    },
  };
}
