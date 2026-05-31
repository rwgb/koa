import type { Tool, ToolInput } from '../../types/index.js';
import type { EngramClient } from '../../engram/client.js';

export function createEngramTool(engram: EngramClient): Tool {
  return {
    name: 'engram_query',
    description:
      'Search the Engram project index by file-path keyword (e.g. "router", "loop", "spiderbrain"). ' +
      'Returns matching source files with their cluster and dependency counts. ' +
      'Use this to locate relevant files by name — NOT for searching code content or session decisions.',
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
