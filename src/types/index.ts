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
  classifierCalls: number;
  classifierInputTokens: number;
  classifierOutputTokens: number;
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
export type ToolResultContent = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema'];
  execute(input: ToolInput): Promise<ToolResultContent>;
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

export type ConfigModelTier = 'fast' | 'standard' | 'powerful';
export const CONFIG_MODEL_MAP: Record<ConfigModelTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-6',
  powerful: 'claude-opus-4-7',
};

export interface ProjectMemory {
  project?: string;
  state?: string;
  backlog?: string;
  handoff?: string;
  journals?: string[];
}

export interface AgentState {
  messages: Anthropic.MessageParam[];
  engramContext: EngramContext;
  spiderBrainContext?: SpiderBrainContext;
  projectMemory?: ProjectMemory;
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
  classifierLatencyMs?: number;
}

export interface ToolUse {
  id: string;
  name: string;
  input: ToolInput;
  result?: string;
}
