/**
 * Sorted set of who's connected to a trip right now (score = last heartbeat).
 * The gateway keeps it fresh; push notifications skip anyone in it.
 */
export const onlineKey = (tripId: string) => `online:${tripId}`;

/** Someone counts as online if the gateway heard from them this recently. */
export const ONLINE_WINDOW_MS = 60_000;
