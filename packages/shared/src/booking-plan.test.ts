import { describe, expect, it } from 'vitest';
import { planItemFor } from './booking-plan';

describe('planItemFor', () => {
  it('puts a flight on its day at its local time', () => {
    expect(
      planItemFor({
        type: 'flight',
        provider: 'IndiGo',
        startsAt: '2026-06-12T02:45:00.000Z',
        endsAt: '2026-06-12T04:00:00.000Z',
        timezone: 'Asia/Kolkata',
        details: { flightNumber: '6E 2134', from: 'BOM', to: 'GOI' },
      }),
    ).toEqual({ title: 'Flight BOM → GOI', type: 'flight', date: '2026-06-12', startTime: '08:15', endTime: '09:30', placeName: 'BOM' });
  });

  it('checks in to a stay without ending it on the first day', () => {
    expect(
      planItemFor({
        type: 'stay',
        provider: 'Casa do Alfama',
        startsAt: '2026-06-12T14:00:00.000Z',
        endsAt: '2026-06-15T10:00:00.000Z',
        timezone: 'Europe/Lisbon',
        details: { address: 'Rua dos Remédios 12, Lisbon' },
      }),
    ).toEqual({ title: 'Check in at Casa do Alfama', type: 'stay', date: '2026-06-12', startTime: '15:00', endTime: null, placeName: 'Rua dos Remédios 12, Lisbon' });
  });

  it('copes with a booking that has no date', () => {
    expect(planItemFor({ type: 'restaurant', provider: null, timezone: 'UTC' })).toMatchObject({ title: 'Table booked', type: 'meal', date: null, startTime: null });
  });
});
