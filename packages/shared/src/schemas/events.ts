import { z } from 'zod';

/**
 * Something changed in a trip. The API publishes these after each write,
 * and the realtime gateway delivers them to everyone viewing the trip.
 */
export const TRIP_EVENT_TYPES = [
  'item.upserted',
  'item.deleted',
  'member.joined',
  'member.updated',
  'member.left',
  'trip.updated',
  'message.created',
  'reaction.changed',
  'read.updated',
  'idea.upserted',
  'idea.deleted',
  'idea.voted',
  'poll.voted',
  'poll.closed',
  'document.upserted',
  'document.deleted',
  'booking.upserted',
  'booking.deleted',
  'photo.upserted',
  'photo.deleted',
  'photo.favourited',
] as const;

export const TripEvent = z.object({
  type: z.enum(TRIP_EVENT_TYPES),
  tripId: z.string().uuid(),
  entityId: z.string().uuid(),
  actorId: z.string().uuid(),
  version: z.number().int().optional(),
  payload: z.unknown().optional(),
  /** The connection that caused the change, so it isn't sent back to it. */
  originClientId: z.string().optional(),
});
export type TripEvent = z.infer<typeof TripEvent>;

/** Messages a phone sends to the gateway. */
export const ClientMessage = z.discriminatedUnion('op', [
  z.object({ op: z.literal('subscribe'), tripId: z.string().uuid() }),
  z.object({ op: z.literal('unsubscribe'), tripId: z.string().uuid() }),
  z.object({
    op: z.literal('editing'),
    tripId: z.string().uuid(),
    itemId: z.string().uuid().nullable(),
  }),
  z.object({ op: z.literal('typing'), tripId: z.string().uuid() }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

/** Someone is typing in the trip chat. Never stored; it fades after a few seconds. */
export const Typing = z.object({
  tripId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
});
export type Typing = z.infer<typeof Typing>;

/** Someone opened (or closed) an item's editor. Never stored. */
export const Presence = z.object({
  tripId: z.string().uuid(),
  userId: z.string().uuid(),
  displayName: z.string(),
  itemId: z.string().uuid().nullable(),
});
export type Presence = z.infer<typeof Presence>;

/** Messages the gateway sends to a phone. */
export const ServerMessage = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready'), clientId: z.string() }),
  z.object({ kind: z.literal('subscribed'), tripId: z.string().uuid() }),
  z.object({ kind: z.literal('event'), event: TripEvent }),
  z.object({ kind: z.literal('presence'), presence: Presence }),
  z.object({ kind: z.literal('typing'), typing: Typing }),
  z.object({
    kind: z.literal('error'),
    code: z.string(),
    message: z.string(),
    tripId: z.string().uuid().optional(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

export const tripChannel = (tripId: string) => `trip:${tripId}`;
export const CLIENT_ID_HEADER = 'x-tagalong-client';
