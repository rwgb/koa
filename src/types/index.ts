import type Anthropic from '@anthropic-ai/sdk';
import type { AgentName } from '../agent/specialists.js';

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  model: string;
  agent?: AgentName;
}

export interface AgentCostEntry {
  turns: number;
  estimatedCostUsd: number;
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
  agentBreakdown: Record<string, AgentCostEntry>;
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

export type ToolInput = Record<string, unknown>;
export type ToolResultContent = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool['input_schema'];
  source?: 'builtin' | 'custom-skill' | 'plugin';
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
  turnCount: number;
  lastModel?: string;
  lastTier?: string;
  lastAgent?: AgentName;
  usage: SessionUsageStats;
}

export interface TurnResult {
  content: string;
  toolUses: ToolUse[];
  stopReason: string;
  model: string;
  tier: string;
  agent: string;
  usage?: TurnUsage;
  classifierLatencyMs?: number;
}

export interface ToolUse {
  id: string;
  name: string;
  input: ToolInput;
  result?: string;
}
