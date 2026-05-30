import type Anthropic from '@anthropic-ai/sdk';

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

export interface KoaConfig {
  model: string;
  maxTokens: number;
  projectPath: string;
  engramEnabled: boolean;
  apiKey?: string;
}

export interface EngramContext {
  goal?: string;
  hotFiles: HotFile[];
  sessionSummary?: string;
  masterFiles: string[];
}

export interface HotFile {
  path: string;
  score: number;
  cluster?: string;
}

export interface EngramSession {
  id: string;
  startedAt: Date;
  goal?: string;
}

export type ToolInput = Record<string, unknown>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema'];
  execute(input: ToolInput): Promise<string>;
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

export interface AgentState {
  messages: Anthropic.MessageParam[];
  engramContext: EngramContext;
  spiderBrainContext?: SpiderBrainContext;
  sessionId?: string;
  turnCount: number;
  lastModel?: string;
  lastTier?: string;
  usage: SessionUsageStats;
}

export interface TurnResult {
  content: string;
  toolUses: ToolUse[];
  stopReason: string;
  model: string;
  tier: string;
  usage?: TurnUsage;
}

export interface ToolUse {
  id: string;
  name: string;
  input: ToolInput;
  result?: string;
}
