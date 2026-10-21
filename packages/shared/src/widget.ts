/**
 * What the Android home-screen widget shows. The app saves the raw facts;
 * the widget works out what to say each time it redraws (every 30 minutes),
 * so "in 25 min" stays true without the app running. Pure, and tested here.
 */
import type { Readiness } from './countdown';
import { toInstant, wallClock } from './zoned-time';

/** One trip, as the app saves it for the widget. */
export interface WidgetTrip {
  id: string;
  name: string;
  coverColor: string;
  startDate: string | null;
  endDate: string | null;
  /** The trip's clock; the phone's when unknown. */
  timezone: string | null;
  readiness: Readiness | null;
  /** Timed stops, for "today's next stop" during the trip. */
  stops: { id: string; date: string; startTime: string; title: string }[];
  bookings: { title: string; startsAt: string }[];
}

export type WidgetView =
  | { kind: 'none' }
  | {
      kind: 'before';
      tripId: string;
      name: string;
      coverColor: string;
      /** "in 4 days", "tomorrow". */
      countdown: string;
      /** "4 of 18 packed", when there's a packing list. */
      packed: string | null;
    }
  | {
      kind: 'during';
      tripId: string;
      name: string;
      coverColor: string;
      /** "Day 2 of 5". */
      day: string;
      nextStop: { id: string; time: string; title: string; when: string } | null;
      nextBooking: { title: string; when: string } | null;
    };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** "now", "in 25 min", "in 2 h", "in 2 h 30 min". */
export const inTime = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `in ${hours} h${rest >= 5 ? ` ${rest} min` : ''}`;
};

/**
 * The trip to show and what to say about it: the trip happening today (on
 * its own clock), or else the next one to start. A trip happening shows its
 * next timed stop today and its next booking; one ahead counts down and says
 * how much is packed.
 */
export const widgetSnapshot = (trips: WidgetTrip[], now: Date, deviceZone = 'UTC'): WidgetView => {
  const dated = trips.filter((t) => t.startDate);
  const todayIn = (t: WidgetTrip) => wallClock(now.toISOString(), t.timezone ?? deviceZone);

  const during = dated
    .filter((t) => {
      const today = todayIn(t).date;
      return t.startDate! <= today && today <= (t.endDate ?? t.startDate!);
    })
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))[0];
  if (during) {
    const zone = during.timezone ?? deviceZone;
    const today = todayIn(during).date;
    const at = (s: WidgetTrip['stops'][number]) => Date.parse(toInstant(s.date, s.startTime.slice(0, 5), zone));
    const next = during.stops
      .filter((s) => s.date === today && at(s) >= now.getTime() - 5 * 60_000)
      .sort((a, b) => at(a) - at(b))[0];
    const booking = during.bookings
      .filter((b) => Date.parse(b.startsAt) >= now.getTime())
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
    const total = dayNumber(during.endDate ?? during.startDate!) - dayNumber(during.startDate!) + 1;
    const dayOf = dayNumber(today) - dayNumber(during.startDate!) + 1;
    return {
      kind: 'during',
      tripId: during.id,
      name: during.name,
      coverColor: during.coverColor,
      day: total > 1 ? `Day ${dayOf} of ${total}` : 'Today',
      nextStop: next ? { id: next.id, time: next.startTime.slice(0, 5), title: next.title, when: inTime(at(next) - now.getTime()) } : null,
      nextBooking: booking
        ? (() => {
            const local = wallClock(booking.startsAt, zone);
            const weekday = WEEKDAYS[new Date(`${local.date}T00:00:00Z`).getUTCDay()];
            return { title: booking.title, when: local.date === today ? `today ${local.time}` : `${weekday} ${local.time}` };
          })()
        : null,
    };
  }

  const ahead = dated
    .filter((t) => t.startDate! > todayIn(t).date)
    .sort((a, b) => (a.startDate! < b.startDate! ? -1 : 1))[0];
  if (!ahead) return { kind: 'none' };
  const days = dayNumber(ahead.startDate!) - dayNumber(todayIn(ahead).date);
  const r = ahead.readiness;
  return {
    kind: 'before',
    tripId: ahead.id,
    name: ahead.name,
    coverColor: ahead.coverColor,
    countdown: days === 1 ? 'tomorrow' : `in ${days} days`,
    packed: r && r.packingTotal > 0 ? `${r.packed} of ${r.packingTotal} packed` : null,
  };
};
