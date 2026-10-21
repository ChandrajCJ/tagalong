import { z } from 'zod';

/**
 * Live location: opt-in, for a few hours, kept only in Redis and never in
 * the database. See ADR 027.
 */

/** At most a day ahead: "1 hour", "4 hours" or "until the end of today". */
export const LIVE_LOCATION_MAX_MS = 24 * 60 * 60 * 1000;
/** One position per person this often, at most. */
export const LOCATION_RATE_SECONDS = 20;
/** Older than this, a pin is shown faded: the phone may have gone quiet. */
export const LOCATION_STALE_MS = 10 * 60 * 1000;

export const ShareLocationInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  /** Metres, as the phone reports it. */
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  /** When sharing stops on its own. */
  until: z.string().datetime({ offset: true }),
});
export type ShareLocationInput = z.input<typeof ShareLocationInput>;

/** Someone's latest position on a trip, while they share it. */
export const LiveLocation = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().nullable(),
  /** When the server got it. */
  at: z.string(),
  until: z.string(),
});
export type LiveLocation = z.infer<typeof LiveLocation>;

export const LiveLocationList = z.object({ locations: z.array(LiveLocation) });

/** `location.stopped`'s payload: who stopped (or ran out of time, or left). */
export const LocationStopped = z.object({ userId: z.string().uuid() });
