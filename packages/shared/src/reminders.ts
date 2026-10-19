import { FLIGHT_REMINDER_MINUTES } from './schemas/notifications';
import { toInstant } from './zoned-time';

/** A timed stop or booking that could get a reminder. */
export interface ReminderStop {
  /** The plan item's or booking's id. */
  id: string;
  kind: 'item' | 'booking';
  tripId: string;
  tripName: string;
  title: string;
  /** When it starts, as an instant. */
  startsAt: string;
  /** "flight", "meal", …: flights get a longer lead. */
  type: string;
  placeName: string | null;
  /** For a booking on a plan item: that item, so the stop isn't reminded twice. */
  itemId?: string | null;
}

/** A reminder that should be scheduled on the phone. */
export interface WantedReminder {
  /** Changes whenever the stop moves, so a moved stop's old reminder is cancelled. */
  key: string;
  fireAt: string;
  title: string;
  body: string;
  /** The screen to open when it's tapped. */
  url: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const leadLabel = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;

/** When a plan item starts, from its date and time on the trip's own clock. */
export const itemStartsAt = (date: string, startTime: string, timezone: string) =>
  toInstant(date, startTime.slice(0, 5), timezone);

/**
 * The reminders that should exist now: one per stop starting within the next
 * `horizonDays`, `leadMinutes` before it (flights at least 3 h), skipping any
 * whose moment has already passed. A booking on a plan item replaces the
 * item's own reminder.
 */
export const wantedReminders = (
  stops: ReminderStop[],
  { leadMinutes, now, horizonDays = 7 }: { leadMinutes: number; now: Date; horizonDays?: number },
): WantedReminder[] => {
  const coveredByBooking = new Set(stops.flatMap((s) => (s.kind === 'booking' && s.itemId ? [s.itemId] : [])));
  const until = now.getTime() + horizonDays * DAY_MS;
  return stops.flatMap((stop): WantedReminder[] => {
    if (stop.kind === 'item' && coveredByBooking.has(stop.id)) return [];
    const starts = Date.parse(stop.startsAt);
    if (Number.isNaN(starts) || starts > until) return [];
    const lead = stop.type === 'flight' ? Math.max(FLIGHT_REMINDER_MINUTES, leadMinutes) : leadMinutes;
    const fireAt = starts - lead * 60_000;
    if (fireAt <= now.getTime()) return [];
    return [
      {
        key: `${stop.kind}:${stop.id}:${new Date(starts).toISOString()}:${lead}`,
        fireAt: new Date(fireAt).toISOString(),
        title: stop.tripName,
        body: `${stop.title}${stop.placeName && stop.placeName !== stop.title ? ` at ${stop.placeName}` : ''} in ${leadLabel(lead)}`,
        url: stop.kind === 'item' ? `/trips/${stop.tripId}/items/${stop.id}` : `/trips/${stop.tripId}`,
      },
    ];
  });
};

/** What to schedule and what to cancel, given the keys already scheduled on the phone. */
export const diffReminders = (wanted: WantedReminder[], scheduledKeys: string[]) => {
  const scheduled = new Set(scheduledKeys);
  const keep = new Set(wanted.map((w) => w.key));
  return {
    schedule: wanted.filter((w) => !scheduled.has(w.key)),
    cancel: scheduledKeys.filter((k) => !keep.has(k)),
  };
};
