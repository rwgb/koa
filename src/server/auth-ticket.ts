import crypto from 'crypto';

export interface SseTicket {
  token: string;
  createdAt: number;
}

// Short-lived SSE ticket store. Tickets are single-use and expire after 30 seconds.
// They prevent the long-lived KOA_WEB_TOKEN from appearing in SSE URLs (proxy logs,
// browser history, server access logs).
export const ticketStore = new Map<string, SseTicket>();

const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 50;

function pruneExpired(): void {
  const cutoff = Date.now() - TICKET_TTL_MS;
  for (const [id, ticket] of ticketStore) {
    if (ticket.createdAt < cutoff) ticketStore.delete(id);
  }
}

/**
 * Issue a one-time SSE ticket for the given bearer token.
 * Returns the ticket ID (64 hex chars) that the client should pass as ?ticket=.
 */
export function issueTicket(token: string): string {
  pruneExpired();
  if (ticketStore.size >= MAX_TICKETS) {
    // Evict the oldest entry to bound memory under runaway retry loops.
    const oldest = ticketStore.keys().next().value;
    if (oldest !== undefined) ticketStore.delete(oldest);
  }
  const ticketId = crypto.randomBytes(32).toString('hex');
  ticketStore.set(ticketId, { token, createdAt: Date.now() });
  return ticketId;
}

/**
 * Consume a one-time SSE ticket. Returns the stored bearer token if the ticket
 * exists and is less than 30 seconds old; null otherwise.
 * Removes the ticket on first use regardless of age.
 */
export function consumeTicket(ticketId: string): string | null {
  const ticket = ticketStore.get(ticketId);
  ticketStore.delete(ticketId);
  if (!ticket) return null;
  if (Date.now() - ticket.createdAt > TICKET_TTL_MS) return null;
  return ticket.token;
}
