export interface InboundMessage {
  channel: 'sms' | 'gmail';
  externalId: string;
  from: string;
  subject?: string;
  body: string;
  receivedAt: string;
}

export interface ExtractedIntent {
  type: 'task' | 'query' | 'note' | 'unknown';
  content: string;
  project?: string;
  deadline?: string;
  priority?: number;
}

export interface ChannelSendResult {
  ok: boolean;
  error?: string;
  attempts: number;
}
