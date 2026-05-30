export type SseEvent =
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'content'; text: string }
  | { type: 'done'; turnCount: number; model: string; tier: string }
  | { type: 'error'; message: string };

export interface EngramContext {
  goal?: string;
  hotFiles: Array<{ path: string; score: number; cluster?: string }>;
  sessionSummary?: string;
  masterFiles: string[];
}

export interface AgentStatus {
  context: EngramContext;
  model: string;
  turnCount: number;
  engramEnabled: boolean;
  activeModel?: string;
  activeTier?: string;
}

// Discriminated union of everything that can appear in the chat timeline
export type ChatItem =
  | { kind: 'user'; content: string; id: string }
  | { kind: 'assistant'; content: string; id: string; tier?: string }
  | { kind: 'tool_call'; name: string; input: Record<string, unknown>; id: string }
  | { kind: 'tool_result'; name: string; result: string; id: string }
  | { kind: 'error'; message: string; id: string };
