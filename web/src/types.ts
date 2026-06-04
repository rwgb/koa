export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  model: string;
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
  classifierCalls?: number;
  classifierInputTokens?: number;
  classifierOutputTokens?: number;
  agentBreakdown?: Record<string, AgentCostEntry>;
}

export type SseEvent =
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'content'; text: string }
  | { type: 'done'; turnCount: number; model: string; tier: string; agent: string; classifierLatencyMs?: number }
  | { type: 'usage'; turn: TurnUsage; session: SessionUsageStats }
  | { type: 'error'; message: string }
  | { type: 'classifying' }
  | { type: 'classified'; tier: string }
  | { type: 'chain_start'; agent: string };

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
  activeAgent?: string;
  usage?: SessionUsageStats;
  spiderBrain?: SpiderBrainContext | null;
  projectPath?: string;
}

export interface AdminConfig {
  model: string;
  maxTokens: number;
  projectPath: string;
  defaultProjectPath: string | null;
  engramEnabled: boolean;
  smartRouting: boolean;
  maxToolOutputChars: number;
  compactAfterTurns: number;
  spiderBrainBrain: string | null;
  spiderBrainAvailable: boolean;
  autoCheckpointTurns: number;
  autoCheckpointMinutes: number;
  apiKeySet: boolean;
  braveApiKey?: boolean;
  autoChaining?: boolean;
  briefingEnabled?: boolean;
  briefingTime?: string;
  ttsProvider?: 'say' | 'elevenlabs';
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
  elevenLabsApiKey?: boolean;
  // write-only: sent in PUT body, never returned by GET
  apiKey?: string;
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
  | 'smtp' | 'homelab' | 'eset' | 'custom_http' | 'mcp_server'
  | 'gmail' | 'twilio' | 'google-calendar';

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
  icon: import('./components/Icon.js').IconName;
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

export interface EscalationSettings {
  enabled: boolean;
}

export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface NotificationsResponse {
  rules: NotificationRule[];
  quietHours: QuietHours;
  escalation: EscalationSettings;
}

// ── Skills ────────────────────────────────────────────────────────────────────

export interface InstalledSkill {
  name: string;
  description: string;
  source: 'built-in' | 'custom' | 'plugin';
  status: 'active';
  type?: 'bash' | 'http' | 'mcp';
}

export interface LoadedPlugin {
  name: string;
  version: string;
  description: string;
  toolCount: number;
  toolNames: string[];
  sourcePath: string;
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

// ── Projects & Tasks ──────────────────────────────────────────────────────────

export type ProjectStatus = 'active' | 'archived' | 'done';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  deadline: string | null;
  effort_hours: number | null;
  actual_hours: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Decision {
  id: string;
  project_id: string;
  title: string;
  context: string;
  options: string[];
  chosen: string;
  rationale: string;
  created_at: string;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
  channels?: Record<string, 'connected' | 'not_configured'>;
  uptime: number;
  version: string;
}

export type InboundChannel = 'sms' | 'gmail' | 'slack';

// ── Conversations ─────────────────────────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  turn_count: number;
  project_id: string | null;
}

export interface ConversationTurn {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_uses: string;
  agent_name: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: string;
}

// ── Calendar ──────────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  google_id: string;
  title: string;
  start_at: string;
  end_at: string;
  all_day: boolean;
  location?: string;
  description?: string;
  attendees: string[];
  synced_at: string;
}

export interface CalendarBlock {
  start: string;
  end: string;
  durationHours: number;
}

export interface ConflictResult {
  hasConflict: boolean;
  reason?: string;
  busyHoursOnDeadlineDay?: number;
  events?: Array<{ title: string; start: string; end: string }>;
}

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface StreakResponse {
  streak: number;
  totalCompletionDays: number;
}

export interface WeeklyReport {
  completedThisWeek: number;
  completedLastWeek: number;
  velocityChange: number;
  currentStreak: number;
  upcomingDeadlines: Task[];
  openHighPriority: number;
}

export interface ProjectForecast {
  projectId: string;
  projectName: string;
  estimatedTotal: number;
  actualTotal: number;
  ratio: number;
  taskCount: number;
}

export interface ForecastSummary {
  projects: ProjectForecast[];
  globalRatio: number | null;
  globalEstimated: number;
  globalActual: number;
  globalTaskCount: number;
}

export interface ProactiveAlert {
  type: 'blocked' | 'end-of-week' | 'overdue' | 'stalled';
  message: string;
  taskCount: number;
}

// Discriminated union of everything that can appear in the chat timeline
export type ChatItem =
  | { kind: 'user'; content: string; id: string; channel?: InboundChannel }
  | { kind: 'assistant'; content: string; id: string; tier?: string; agent?: string }
  | { kind: 'tool_call'; name: string; input: Record<string, unknown>; id: string }
  | { kind: 'tool_result'; name: string; result: string; id: string }
  | { kind: 'error'; message: string; id: string };
