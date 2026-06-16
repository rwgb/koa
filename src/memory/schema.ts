export type MemoryEventType =
  | 'preference' | 'standing-order' | 'boundary' | 'assertion' | 'correction'
  | 'decision' | 'failure' | 'journal'

export const GLOBAL_TYPES: MemoryEventType[] = ['preference', 'standing-order', 'boundary', 'assertion', 'correction']
export const PROJECT_TYPES: MemoryEventType[] = ['decision', 'failure', 'journal']

export interface MemoryEntry {
  id: string
  type: MemoryEventType
  content: string
  tags: string[]        // stored as JSON TEXT in DB
  action_type?: 'notify' | 'brief' | 'agent'  // standing-order only
  trigger_pattern?: string                      // standing-order only
  created_at: string    // ISO string
  expires_at?: string   // ISO string; undefined = permanent
}

export type NewMemoryEntry = Omit<MemoryEntry, 'id' | 'created_at'>
