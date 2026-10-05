import { CLIENT_ID_HEADER, tripChannel, type TripEvent } from '@tagalong/shared';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';

/**
 * Announces a change to everyone viewing the trip. Call it only after the
 * transaction commits, so nobody hears about a change that was rolled back.
 * A failed publish is logged, never thrown: the write already succeeded, and
 * clients catch up by refetching when they reconnect.
 */
export const publishTripEvent = async (redis: Redis, event: TripEvent) => {
  try {
    await redis.publish(tripChannel(event.tripId), JSON.stringify(event));
  } catch (err) {
    console.error('Failed to publish trip event', event.type, err);
  }
};

/** Which connection made this request, so the gateway can skip echoing it back. */
export const originOf = (request: FastifyRequest): string | undefined => {
  const value = request.headers[CLIENT_ID_HEADER];
  return typeof value === 'string' && value.length <= 64 ? value : undefined;
};
