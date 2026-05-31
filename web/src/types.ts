export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  model: string;
}

export interface SessionUsageStats {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  estimatedCostUsd: number;
  cacheHitRate: number;
  turnsCount: number;
}

export type SseEvent =
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'content'; text: string }
  | { type: 'done'; turnCount: number; model: string; tier: string }
  | { type: 'usage'; turn: TurnUsage; session: SessionUsageStats }
  | { type: 'error'; message: string };

export interface EngramContext {
  goal?: string;
  hotFiles: Array<{ path: string; score: number; cluster?: string }>;
  sessionSummary?: string;
  masterFiles: string[];
}

export interface SpiderBrainMaster {
  id: string;
  webscore: number;
  cluster: string;
  role?: string;
  fanIn: number;
}

export interface SpiderBrainContext {
  available: boolean;
  prey: string;
  masters: SpiderBrainMaster[];
  hotFiles: string[];
  clusterNames: string[];
}

export interface AgentStatus {
  context: EngramContext;
  model: string;
  turnCount: number;
  engramEnabled: boolean;
  activeModel?: string;
  activeTier?: string;
  usage?: SessionUsageStats;
  spiderBrain?: SpiderBrainContext | null;
  projectPath?: string;
}

// Discriminated union of everything that can appear in the chat timeline
export type ChatItem =
  | { kind: 'user'; content: string; id: string }
  | { kind: 'assistant'; content: string; id: string; tier?: string }
  | { kind: 'tool_call'; name: string; input: Record<string, unknown>; id: string }
  | { kind: 'tool_result'; name: string; result: string; id: string }
  | { kind: 'error'; message: string; id: string };
