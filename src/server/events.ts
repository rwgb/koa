import type { TurnUsage, SessionUsageStats } from '../types/index.js';

export type SseEvent =
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'content'; text: string }
  | { type: 'done'; turnCount: number; model: string; tier: string; agent: string; classifierLatencyMs?: number }
  | { type: 'usage'; turn: TurnUsage; session: SessionUsageStats }
  | { type: 'error'; message: string }
  | { type: 'classifying' }
  | { type: 'classified'; tier: string };
