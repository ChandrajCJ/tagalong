import { describe, expect, it } from 'vitest';
import { freshness, shareUntil, timeLeft } from './live-location';
import { inTime, widgetSnapshot, type WidgetTrip } from './widget';

const trip = (over: Partial<WidgetTrip>): WidgetTrip => ({
  id: 'goa',
  name: 'Goa',
  coverColor: '#D8A47F',
  startDate: '2026-11-01',
  endDate: '2026-11-05',
  timezone: 'Asia/Kolkata',
  readiness: { packed: 4, packingTotal: 18, todosOpen: 2 },
  stops: [],
  bookings: [],
  ...over,
});

describe('the home-screen widget', () => {
  it('counts down to the next trip, with how much is packed', () => {
    const view = widgetSnapshot([trip({}), trip({ id: 'later', name: 'Later', startDate: '2026-12-20', endDate: null })], new Date('2026-10-28T06:00:00Z'));
    expect(view).toEqual({ kind: 'before', tripId: 'goa', name: 'Goa', coverColor: '#D8A47F', countdown: 'in 4 days', packed: '4 of 18 packed' });
    expect(widgetSnapshot([trip({ readiness: null })], new Date('2026-10-31T06:00:00Z'))).toMatchObject({ countdown: 'tomorrow', packed: null });
  });

  it('during a trip, shows today’s next stop and the next booking', () => {
    const view = widgetSnapshot(
      [
        trip({
          stops: [
            { id: 'a', date: '2026-11-02', startTime: '09:00', title: 'Breakfast' },
            { id: 'b', date: '2026-11-02', startTime: '13:00', title: 'Beach shack lunch' },
            { id: 'c', date: '2026-11-03', startTime: '08:00', title: 'Spice farm' },
          ],
          bookings: [
            { title: 'Flight GOI → BOM', startsAt: '2026-11-05T12:30:00Z' },
            { title: 'Boat trip', startsAt: '2026-10-30T05:00:00Z' },
          ],
        }),
      ],
      // 12:35 in India on 2 November.
      new Date('2026-11-02T07:05:00Z'),
    );
    expect(view).toEqual({
      kind: 'during',
      tripId: 'goa',
      name: 'Goa',
      coverColor: '#D8A47F',
      day: 'Day 2 of 5',
      nextStop: { id: 'b', time: '13:00', title: 'Beach shack lunch', when: 'in 25 min' },
      nextBooking: { title: 'Flight GOI → BOM', when: 'Thu 18:00' },
    });
  });

  it('says nothing about a stop once the day’s are over, and prefers the trip happening now', () => {
    const now = new Date('2026-11-02T16:00:00Z');
    const view = widgetSnapshot([trip({ id: 'next', startDate: '2026-11-10', endDate: '2026-11-12' }), trip({ stops: [{ id: 'a', date: '2026-11-02', startTime: '09:00', title: 'Breakfast' }] })], now);
    expect(view).toMatchObject({ kind: 'during', tripId: 'goa', nextStop: null, nextBooking: null });
  });

  it('decides “today” on the trip’s own clock', () => {
    // 20:00 UTC on 31 October is already 1 November in India: the trip has begun.
    const now = new Date('2026-10-31T20:00:00Z');
    expect(widgetSnapshot([trip({})], now).kind).toBe('during');
    // In Lisbon it's still 31 October: tomorrow.
    expect(widgetSnapshot([trip({ timezone: 'Europe/Lisbon' })], now)).toMatchObject({ kind: 'before', countdown: 'tomorrow' });
    // Without a zone, the phone's.
    expect(widgetSnapshot([trip({ timezone: null })], now, 'America/New_York')).toMatchObject({ kind: 'before' });
  });

  it('shows nothing without an upcoming trip', () => {
    expect(widgetSnapshot([trip({ startDate: '2026-01-01', endDate: '2026-01-03' }), trip({ startDate: null, endDate: null })], new Date('2026-10-28T06:00:00Z'))).toEqual({ kind: 'none' });
    expect(inTime(30_000)).toBe('now');
    expect(inTime(150 * 60_000)).toBe('in 2 h 30 min');
  });
});

describe('live location times', () => {
  const now = new Date('2026-10-21T10:00:00Z');

  it('shares for an hour, four, or to the end of today on my clock', () => {
    expect(shareUntil('1h', now, 'Asia/Kolkata')).toBe('2026-10-21T11:00:00.000Z');
    expect(shareUntil('4h', now, 'Asia/Kolkata')).toBe('2026-10-21T14:00:00.000Z');
    // 23:59 in India is 18:29 UTC.
    expect(shareUntil('today', now, 'Asia/Kolkata')).toBe('2026-10-21T18:29:00.000Z');
    // Nearly midnight already: an hour instead.
    expect(shareUntil('today', new Date('2026-10-21T18:10:00Z'), 'Asia/Kolkata')).toBe('2026-10-21T19:10:00.000Z');
  });

  it('says how long is left and how old a position is', () => {
    expect(timeLeft('2026-10-21T12:00:00Z', now)).toBe('2 h left');
    expect(timeLeft('2026-10-21T10:25:00Z', now)).toBe('25 min left');
    expect(freshness('2026-10-21T09:57:00Z', now)).toEqual({ label: '3 min ago', stale: false });
    expect(freshness('2026-10-21T09:45:00Z', now)).toEqual({ label: '15 min ago', stale: true });
  });
});
