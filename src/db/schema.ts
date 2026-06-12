export type ProjectStatus = 'active' | 'archived' | 'done';
export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export interface Project {
  id: string;           // UUID via crypto.randomUUID()
  slug: string;         // kebab-case, unique
  name: string;
  description: string;
  status: ProjectStatus;
  budget_usd?: number | null;  // optional per-project spending cap in USD
  created_at: string;   // ISO 8601
  updated_at: string;
}

export interface Task {
  id: string;           // "<project_slug>-task-<timestamp>"
  project_id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;     // 1 (highest) - 5 (lowest)
  deadline: string | null; // ISO 8601 date or null
  effort_hours: number | null;
  actual_hours: number | null;
  tags: string[];       // stored as JSON in SQLite
  created_at: string;
  updated_at: string;
}

export interface TaskDependency {
  task_id: string;
  depends_on_id: string;
}

export interface AuditLog {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface Decision {
  id: string;
  project_id: string;
  title: string;
  context: string;
  options: string[];    // stored as JSON in SQLite
  chosen: string;
  rationale: string;
  created_at: string;
}

export interface Checkpoint {
  id: string;
  project_id: string;
  label: string;
  notes: string;
  created_at: string;
}

export interface ProcessedMessage {
  id: string;
  channel: 'sms' | 'gmail';
  external_id: string;
  content_hash: string;
  intent?: string;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  google_id: string;
  title: string;
  start_at: string;   // ISO 8601
  end_at: string;     // ISO 8601
  all_day: boolean;
  location?: string;
  description?: string;
  attendees: string[];
  recurrence?: string;
  synced_at: string;
}

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
  tool_uses: string;  // JSON array
  agent_name: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: string;
}

export type EscalationLevel = 'due-tomorrow' | '24h' | '8h' | 'overdue';

export interface NotificationLog {
  id: number;
  task_id: string;
  escalation_level: EscalationLevel;
  channel: string;
  sent_at: string;  // ISO 8601
}
