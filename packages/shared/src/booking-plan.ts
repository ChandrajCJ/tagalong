import type { BookingType } from './schemas/bookings';
import type { ItemType } from './schemas/itinerary';
import { wallClock } from './zoned-time';

/** The plan item a booking most naturally is. */
export const ITEM_TYPE_FOR_BOOKING: Record<BookingType, ItemType> = {
  flight: 'flight',
  stay: 'stay',
  train: 'transport',
  car: 'transport',
  ticket: 'activity',
  restaurant: 'meal',
};

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * A plan item for a booking that came in by email: "Flight BOM → GOI" on its
 * day at its local time, so it shows up in the plan rather than only in a list.
 */
export const planItemFor = (b: {
  type: BookingType;
  provider?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  timezone: string;
  details?: Record<string, unknown>;
}) => {
  const d = b.details ?? {};
  const route = text(d.from) && text(d.to) ? `${text(d.from)} → ${text(d.to)}` : null;
  const title =
    b.type === 'flight'
      ? `Flight ${route ?? text(d.flightNumber) ?? b.provider ?? ''}`.trim()
      : b.type === 'train'
        ? `Train ${route ?? text(d.trainNumber) ?? ''}`.trim()
        : b.type === 'car'
          ? `Pick up the car${b.provider ? ` (${b.provider})` : ''}`
          : b.type === 'stay'
            ? `Check in${b.provider ? ` at ${b.provider}` : ''}`
            : (b.provider ?? (b.type === 'restaurant' ? 'Table booked' : 'Tickets'));
  const start = b.startsAt ? wallClock(b.startsAt, b.timezone) : null;
  const end = b.endsAt ? wallClock(b.endsAt, b.timezone) : null;
  const placeName =
    text(d.address) ?? text(d.venue) ?? text(d.pickup) ?? (b.type === 'flight' || b.type === 'train' ? text(d.from) : null);
  return {
    title: title.slice(0, 200),
    type: ITEM_TYPE_FOR_BOOKING[b.type],
    date: start?.date ?? null,
    // Midnight usually means "no time given".
    startTime: start && start.time !== '00:00' ? start.time : null,
    // A stay's check-out is days later: that's not when the item ends.
    endTime: start && end && end.date === start.date && b.type !== 'stay' ? end.time : null,
    placeName: placeName?.slice(0, 200) ?? null,
  };
};
