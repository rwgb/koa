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
  classifierCalls?: number;
  classifierInputTokens?: number;
  classifierOutputTokens?: number;
}

export type SseEvent =
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'content'; text: string }
  | { type: 'done'; turnCount: number; model: string; tier: string; classifierLatencyMs?: number }
  | { type: 'usage'; turn: TurnUsage; session: SessionUsageStats }
  | { type: 'error'; message: string }
  | { type: 'classifying' }
  | { type: 'classified'; tier: string };

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

export interface AdminConfig {
  model: string;
  maxTokens: number;
  projectPath: string;
  engramEnabled: boolean;
  smartRouting: boolean;
  maxToolOutputChars: number;
  compactAfterTurns: number;
  spiderBrainBrain: string | null;
  autoCheckpointTurns: number;
  autoCheckpointMinutes: number;
  apiKeySet: boolean;
}

export interface MemoryEntry {
  fact: string;
  timestamp: string;
}

export interface ProjectFileEntry {
  content: string | null;
}

export interface MemoryFilesResponse {
  files: Record<string, ProjectFileEntry>;
  dir: string;
}

export interface EngramMemoryResponse {
  engram: EngramContext;
  spiderBrain: SpiderBrainContext | null;
  engramEnabled: boolean;
}

export interface JournalSession {
  date: string;
  content: string;
}

export interface ActivitySessionsResponse {
  sessions: JournalSession[];
}

// ── Integrations ──────────────────────────────────────────────────────────────

export type IntegrationType =
  | 'anthropic' | 'github' | 'slack' | 'pushover' | 'ntfy'
  | 'smtp' | 'homelab' | 'eset' | 'custom_http' | 'mcp_server';

export interface Integration {
  id: string;
  type: IntegrationType | string;
  name: string;
  status: 'connected' | 'not_configured' | 'error';
  config: Record<string, string>;
  errorMsg?: string;
}

export interface IntegrationFieldDef {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  hint?: string;
}

export interface IntegrationDef {
  type: IntegrationType;
  name: string;
  icon: string;
  description: string;
  fields: IntegrationFieldDef[];
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface NotificationRule {
  id: string;
  event: string;
  channel: string;
  condition?: string;
  template?: string;
}

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
}

export interface NotificationsResponse {
  rules: NotificationRule[];
  quietHours: QuietHours;
}

// ── Skills ────────────────────────────────────────────────────────────────────

export interface InstalledSkill {
  name: string;
  description: string;
  source: 'built-in' | 'custom';
  status: 'active';
  type?: 'bash' | 'http' | 'mcp';
}

export interface MarketplaceSkill {
  name: string;
  description: string;
  icon: string;
  requires: string[];
}

export interface SkillsResponse {
  installed: InstalledSkill[];
  marketplace: MarketplaceSkill[];
}

export interface CustomSkillDef {
  name: string;
  description: string;
  type: 'bash' | 'http' | 'mcp';
  config: Record<string, string>;
  createdAt: string;
}

// Discriminated union of everything that can appear in the chat timeline
export type ChatItem =
  | { kind: 'user'; content: string; id: string }
  | { kind: 'assistant'; content: string; id: string; tier?: string }
  | { kind: 'tool_call'; name: string; input: Record<string, unknown>; id: string }
  | { kind: 'tool_result'; name: string; result: string; id: string }
  | { kind: 'error'; message: string; id: string };
