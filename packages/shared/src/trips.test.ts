import { describe, expect, it } from 'vitest';
import { groupTrips } from './schemas/trips';

const trip = (name: string, startDate: string | null, endDate: string | null, archived = false) => ({
  name,
  startDate,
  endDate,
  archived,
});

describe('groupTrips', () => {
  const today = '2026-10-19';

  it('puts trips that ended before today under past, newest first', () => {
    const { upcoming, past } = groupTrips(
      [
        trip('Goa', '2026-03-01', '2026-03-05'),
        trip('Lisbon', '2026-11-01', '2026-11-08'),
        trip('Porto', '2026-09-01', '2026-09-04'),
        trip('Now', '2026-10-17', '2026-10-19'),
        trip('Someday', null, null),
      ],
      today,
    );
    expect(upcoming.map((t) => t.name)).toEqual(['Lisbon', 'Now', 'Someday']);
    expect(past.map((t) => t.name)).toEqual(['Porto', 'Goa']);
  });

  it('uses the start date when there is no end date', () => {
    const { past } = groupTrips([trip('Day trip', '2026-10-01', null)], today);
    expect(past).toHaveLength(1);
  });

  it('keeps archived trips apart, whatever their dates', () => {
    const { upcoming, past, archived } = groupTrips(
      [trip('Old', '2025-01-01', '2025-01-02', true), trip('Soon', '2026-12-01', null, true)],
      today,
    );
    expect(upcoming).toEqual([]);
    expect(past).toEqual([]);
    expect(archived.map((t) => t.name)).toEqual(['Old', 'Soon']);
  });
});
