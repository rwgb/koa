import type { Tool, ToolInput } from '../../types/index.js';
import type { EngramClient } from '../../engram/client.js';

export function createEngramTool(engram: EngramClient): Tool {
  return {
    name: 'engram_query',
    description:
      'Search project memory (Engram) for context about files, decisions, or history. Use this to recall what was previously worked on.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms to query Engram memory',
        },
      },
      required: ['query'],
    },
    async execute(input: ToolInput): Promise<string> {
      const query = input['query'] as string;
      const result = await engram.query(query);
      return result || '(no results found in Engram memory)';
    },
  };
}
