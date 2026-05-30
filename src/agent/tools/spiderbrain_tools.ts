import type { Tool, ToolInput } from '../../types/index.js';
import type { SpiderBrainClient } from '../../spiderbrain/client.js';

export function createSpiderBrainTools(sb: SpiderBrainClient): Tool[] {
  return [
    {
      name: 'spiderbrain_query',
      description:
        'Search the SpiderBrain structural graph for files, clusters, or concepts. Returns nodes ranked by webscore × recency.',
      inputSchema: {
        type: 'object',
        properties: {
          terms: {
            type: 'string',
            description: 'Search terms to query the SpiderBrain graph',
          },
        },
        required: ['terms'],
      },
      async execute(input: ToolInput): Promise<string> {
        const terms = input['terms'] as string;
        const result = await sb.query(terms);
        return result || '(no results)';
      },
    },
    {
      name: 'spiderbrain_cascade',
      description:
        'Simulate a fault at a file and show its blast radius through the dependency graph. Run before editing high-mass files.',
      inputSchema: {
        type: 'object',
        properties: {
          node_id: {
            type: 'string',
            description: 'The file path (node ID) to simulate a fault at',
          },
        },
        required: ['node_id'],
      },
      async execute(input: ToolInput): Promise<string> {
        const nodeId = input['node_id'] as string;
        const result = await sb.cascade(nodeId);
        return result || '(no cascade output)';
      },
    },
    {
      name: 'spiderbrain_molt',
      description:
        'Run a drift audit on the SpiderBrain graph. Surfaces orphans, dangling edges, and stale webscore divergence.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      async execute(_input: ToolInput): Promise<string> {
        const result = await sb.molt();
        return result || '(no molt output)';
      },
    },
  ];
}
