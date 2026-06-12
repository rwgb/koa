import type Anthropic from '@anthropic-ai/sdk';
import type { AgentName } from '../agent/specialists.js';

/**
 * Model tiers for cost-aware model selection (API Cost Optimization, Phase 2).
 * - fast:     internal/non-user-facing calls (classification, doc generation, summaries)
 * - standard: default user-facing agent turns
 * - powerful: explicit user escalation only
 */
export type ModelTier = 'fast' | 'standard' | 'powerful';

export const MODEL_MAP: Record<ModelTier, string> = {
  fast: 'claude-haiku-4-5-20251001',
  standard: 'claude-sonnet-4-6',
  powerful: 'claude-opus-4-7',
};

/**
 * Per-agent configuration. `model` selects the tier used for user-facing
 * turns; when omitted, defaults to 'standard' (Sonnet).
 */
export interface AgentConfig {
  model?: ModelTier;
}

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

export interface ContextStats {
  totalMessages: number;
  estimatedTokens: number;
  clusterCount: number;
  lastCompactionAt: string | null;
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
  contextStats?: ContextStats;
  chainedResult?: { content: string; agent: string };
}

export interface ToolUse {
  id: string;
  name: string;
  input: ToolInput;
  result?: string;
}
