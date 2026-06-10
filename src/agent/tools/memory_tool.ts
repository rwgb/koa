import { addMemory, removeMemory } from '../../memory/store.js';
import type { Tool } from '../../types/index.js';

export function createRememberTool(userName: string): Tool {
  return {
    name: 'remember',
    description:
      'Save a fact or piece of information to persistent memory. ' +
      'Use this when the user asks you to remember something — it will be available in all future sessions. ' +
      `Write the fact as a complete, self-contained sentence (e.g. "${userName} prefers dark mode").`,
    inputSchema: {
      type: 'object',
      properties: {
        fact: {
          type: 'string',
          description: 'The fact to remember, as a complete sentence.',
        },
      },
      required: ['fact'],
    },
    execute: async (input: Record<string, unknown>) => {
      const fact = String(input['fact'] ?? '').trim();
      if (!fact) return 'Nothing to remember — fact was empty.';
      addMemory(fact);
      return `Remembered: "${fact}"`;
    },
  };
}

// Backward-compat export for code that imports rememberTool directly
export const rememberTool: Tool = createRememberTool('User');

export const forgetTool: Tool = {
  name: 'forget',
  description:
    'Remove a previously saved memory. Matches by substring — any memory containing the given text will be removed.',
  inputSchema: {
    type: 'object',
    properties: {
      fact: {
        type: 'string',
        description: 'Text to match against stored memories.',
      },
    },
    required: ['fact'],
  },
  execute: async (input: Record<string, unknown>) => {
    const fact = String(input['fact'] ?? '').trim();
    if (!fact) return 'Nothing to forget — fact was empty.';
    const removed = removeMemory(fact);
    return removed ? `Forgot memories matching: "${fact}"` : `No memories matched: "${fact}"`;
  },
};
