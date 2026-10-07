import { describe, expect, it } from 'vitest';
import { safeZone, toInstant, wallClock } from './zoned-time';

describe('toInstant', () => {
  it('reads a wall-clock time in the given zone, not the machine running it', () => {
    // Lisbon is UTC+1 in June.
    expect(toInstant('2026-06-12', '08:15', 'Europe/Lisbon')).toBe('2026-06-12T07:15:00.000Z');
    // Goa is UTC+5:30 all year: a half-hour offset catches sloppy maths.
    expect(toInstant('2026-12-19', '14:00', 'Asia/Kolkata')).toBe('2026-12-19T08:30:00.000Z');
    // New York is behind UTC, so the instant lands on the next UTC day.
    expect(toInstant('2026-06-12', '22:00', 'America/New_York')).toBe('2026-06-13T02:00:00.000Z');
  });

  it('uses the right offset on each side of a daylight-saving change', () => {
    // Europe moves its clocks forward on the last Sunday of March.
    expect(toInstant('2026-03-28', '12:00', 'Europe/Lisbon')).toBe('2026-03-28T12:00:00.000Z');
    expect(toInstant('2026-03-30', '12:00', 'Europe/Lisbon')).toBe('2026-03-30T11:00:00.000Z');
    // And back on the last Sunday of October.
    expect(toInstant('2026-10-24', '12:00', 'Europe/Lisbon')).toBe('2026-10-24T11:00:00.000Z');
    expect(toInstant('2026-10-26', '12:00', 'Europe/Lisbon')).toBe('2026-10-26T12:00:00.000Z');
  });

  it('settles on the right hour on the morning the clocks change', () => {
    // 2026-03-29 in Lisbon: 01:00 jumps to 02:00. 03:00 is safely after.
    expect(toInstant('2026-03-29', '03:00', 'Europe/Lisbon')).toBe('2026-03-29T02:00:00.000Z');
  });
});

describe('wallClock', () => {
  it('turns an instant back into the date and time on a local clock', () => {
    expect(wallClock('2026-06-12T07:15:00.000Z', 'Europe/Lisbon')).toEqual({
      date: '2026-06-12',
      time: '08:15',
    });
    expect(wallClock('2026-06-13T02:00:00.000Z', 'America/New_York')).toEqual({
      date: '2026-06-12',
      time: '22:00',
    });
  });

  it('round-trips with toInstant across zones', () => {
    for (const tz of ['Europe/Lisbon', 'Asia/Kolkata', 'America/Los_Angeles', 'Australia/Sydney']) {
      const iso = toInstant('2026-08-03', '19:45', tz);
      expect(wallClock(iso, tz)).toEqual({ date: '2026-08-03', time: '19:45' });
    }
  });

  it('shows midnight as 00:00, not 24:00', () => {
    expect(wallClock('2026-06-12T00:00:00.000Z', 'UTC').time).toBe('00:00');
  });
});

describe('safeZone', () => {
  it('keeps a real zone and replaces one it does not recognise', () => {
    expect(safeZone('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(safeZone('Not/AZone')).not.toBe('Not/AZone');
  });
});
