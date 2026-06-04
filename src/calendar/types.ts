export interface CalendarBlock {
  start: string; // ISO 8601
  end: string;   // ISO 8601
  durationHours: number;
}

export interface ConflictResult {
  hasConflict: boolean;
  reason?: string;
  busyHoursOnDeadlineDay?: number;
  events?: Array<{ title: string; start: string; end: string }>;
}
