import { describe, expect, it } from 'vitest';
import { diffReminders, itemStartsAt, wantedReminders, type ReminderStop } from './reminders';

const stop = (over: Partial<ReminderStop>): ReminderStop => ({
  id: 'lunch',
  kind: 'item',
  tripId: 't1',
  tripName: 'Goa',
  title: 'Lunch',
  startsAt: '2026-10-20T07:00:00.000Z',
  type: 'meal',
  placeName: "Fisherman's Wharf",
  ...over,
});

describe('itemStartsAt', () => {
  it('reads the time on the trip’s own clock', () => {
    // 12:30 in Goa (UTC+5:30) is 07:00 UTC.
    expect(itemStartsAt('2026-10-20', '12:30:00', 'Asia/Kolkata')).toBe('2026-10-20T07:00:00.000Z');
    // Lisbon in summer is UTC+1; in winter, UTC+0.
    expect(itemStartsAt('2026-07-01', '09:00', 'Europe/Lisbon')).toBe('2026-07-01T08:00:00.000Z');
    expect(itemStartsAt('2026-12-01', '09:00', 'Europe/Lisbon')).toBe('2026-12-01T09:00:00.000Z');
  });
});

describe('wantedReminders', () => {
  const now = new Date('2026-10-19T12:00:00.000Z');

  it('reminds the chosen time before, with where it is', () => {
    expect(wantedReminders([stop({})], { leadMinutes: 30, now })).toEqual([
      {
        key: 'item:lunch:2026-10-20T07:00:00.000Z:30',
        fireAt: '2026-10-20T06:30:00.000Z',
        title: 'Goa',
        body: "Lunch at Fisherman's Wharf in 30 min",
        url: '/trips/t1/items/lunch',
      },
    ]);
  });

  it('gives flights at least three hours', () => {
    const [flight] = wantedReminders([stop({ id: 'f', kind: 'booking', type: 'flight', placeName: null, title: 'TP 1234' })], {
      leadMinutes: 30,
      now,
    });
    expect(flight).toMatchObject({ fireAt: '2026-10-20T04:00:00.000Z', body: 'TP 1234 in 3 h' });
  });

  it('skips the past, anything beyond a week, and items a booking already covers', () => {
    const list = wantedReminders(
      [
        stop({ id: 'soon', startsAt: '2026-10-19T12:20:00.000Z' }), // reminder time already gone
        stop({ id: 'far', startsAt: '2026-10-28T12:00:00.000Z' }),
        stop({ id: 'checkin' }),
        stop({ id: 'b1', kind: 'booking', itemId: 'checkin', type: 'stay', title: 'Hotel check-in' }),
      ],
      { leadMinutes: 60, now },
    );
    expect(list.map((r) => r.key)).toEqual(['booking:b1:2026-10-20T07:00:00.000Z:60']);
  });
});

describe('diffReminders', () => {
  it('schedules what’s new and cancels what moved or went', () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    const wanted = wantedReminders([stop({}), stop({ id: 'dinner', startsAt: '2026-10-20T14:00:00.000Z' })], { leadMinutes: 30, now });
    const moved = 'item:lunch:2026-10-20T06:00:00.000Z:30';
    const { schedule, cancel } = diffReminders(wanted, [moved, 'item:dinner:2026-10-20T14:00:00.000Z:30']);
    expect(schedule.map((r) => r.key)).toEqual(['item:lunch:2026-10-20T07:00:00.000Z:30']);
    expect(cancel).toEqual([moved]);
  });
});
