import { request } from './api';

/** At most one "delivered" call per trip every two seconds, however many messages arrive. */
const FLUSH_MS = 2_000;

const pending = new Map<string, { messageId: string; createdAt: string }>();
let timer: ReturnType<typeof setTimeout> | null = null;

const flush = () => {
  timer = null;
  const batch = [...pending.entries()];
  pending.clear();
  for (const [tripId, { messageId }] of batch) {
    // Best effort: the next message, or opening the chat, says it again.
    void request(`/trips/${tripId}/delivered`, { method: 'POST', body: { upTo: messageId } }).catch(() => undefined);
  }
};

/**
 * Tells the server this phone has received messages up to this one, for the
 * sender's ✓✓. Only the newest per trip is sent; the server never moves back.
 */
export const noteDelivered = (tripId: string, message: { id: string; createdAt: string }) => {
  const current = pending.get(tripId);
  if (!current || current.createdAt < message.createdAt) {
    pending.set(tripId, { messageId: message.id, createdAt: message.createdAt });
  }
  timer ??= setTimeout(flush, FLUSH_MS);
};
