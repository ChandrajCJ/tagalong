import type { CalendarFeed, ItineraryItem, NewCalendarFeed } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const LISBON = { placeId: 'osm:R:5400890', latitude: 38.7223, longitude: -9.1393, bounds: null, countryCode: 'PT' };

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token?: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: token ? bearer(token) : {}, payload });

const unfold = (ics: string) => ics.replace(/\r\n /g, '');

/** A Lisbon trip with a timed stop, an untimed one and a flight. */
const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  ctx.geo.answers.timezone = 'Europe/Lisbon';
  const trip = (
    await call('POST', '/trips', owner.accessToken, {
      name: 'Lisbon',
      destination: 'Lisbon, Portugal',
      location: LISBON,
      startDate: '2026-10-22',
      endDate: '2026-10-25',
    })
  ).json<{ id: string }>();
  const lunch = (
    await call('POST', `/trips/${trip.id}/items`, owner.accessToken, {
      title: 'Lunch, Time Out Market',
      date: '2026-10-23',
      startTime: '13:00',
      endTime: '14:30',
      placeName: 'Time Out Market',
    })
  ).json<ItineraryItem>();
  const walk = (await call('POST', `/trips/${trip.id}/items`, owner.accessToken, { title: 'Walk in Alfama', date: '2026-10-24' })).json<ItineraryItem>();
  const flight = (
    await call('POST', `/trips/${trip.id}/bookings`, owner.accessToken, {
      type: 'flight',
      provider: 'TAP Air Portugal',
      reference: 'X7K2QP',
      startsAt: '2026-10-22T07:15:00Z',
      endsAt: '2026-10-22T09:45:00Z',
      timezone: 'Europe/London',
      details: { flightNumber: 'TP1351', from: 'LHR', to: 'LIS' },
    })
  ).json<{ id: string }>();
  return { owner, tripId: trip.id, lunch, walk, flight };
};

const startFeed = async (token: string) => {
  const res = await call('POST', '/me/calendar', token);
  expect(res.statusCode).toBe(201);
  return res.json<NewCalendarFeed>();
};

describe('the calendar feed', () => {
  it('serves my trips, timed stops and bookings to anyone holding the link', async () => {
    const { owner, tripId, lunch, walk, flight } = await setup();
    const other = await ctx.signIn('other@example.com');
    const theirs = (await call('POST', '/trips', other.accessToken, { name: 'Goa', destination: 'Goa', startDate: '2026-12-20' })).json<{ id: string }>();
    const { token } = await startFeed(owner.accessToken);

    const res = await call('GET', `/calendar/${token}.ics`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    const ics = unfold(res.body);
    expect(ics).toContain(`UID:trip-${tripId}@tagalong`);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261022\r\nDTEND;VALUE=DATE:20261026');
    expect(ics).toContain(`UID:item-${lunch.id}@tagalong\r\nSEQUENCE:1`);
    expect(ics).toContain('DTSTART;TZID=Europe/Lisbon:20261023T130000\r\nDTEND;TZID=Europe/Lisbon:20261023T143000');
    expect(ics).toContain('SUMMARY:Lunch\\, Time Out Market');
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:Europe/Lisbon');
    expect(ics).toContain(`UID:booking-${flight.id}@tagalong`);
    expect(ics).toContain('DTSTART:20261022T071500Z\r\nDTEND:20261022T094500Z');
    expect(ics).toContain('Booking reference: X7K2QP');
    // Untimed stops stay out until asked for; other people's trips never come in.
    expect(ics).not.toContain(walk.id);
    expect(ics).not.toContain(theirs.id);

    const status = (await call('GET', '/me/calendar', owner.accessToken)).json<CalendarFeed>();
    expect(status).toMatchObject({ active: true, includeUntimed: false });
    expect(status.lastFetchedAt).not.toBeNull();
  });

  it('adds stops without a time as all-day items when asked', async () => {
    const { owner, walk } = await setup();
    const { token } = await startFeed(owner.accessToken);
    expect((await call('PATCH', '/me/calendar', owner.accessToken, { includeUntimed: true })).json<CalendarFeed>().includeUntimed).toBe(true);
    const ics = unfold((await call('GET', `/calendar/${token}.ics`)).body);
    expect(ics).toContain(`UID:item-${walk.id}@tagalong`);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261024\r\nDTEND;VALUE=DATE:20261025');
  });

  it('keeps an event’s UID when it changes, with a higher SEQUENCE', async () => {
    const { owner, lunch } = await setup();
    const { token } = await startFeed(owner.accessToken);
    await call('PATCH', `/items/${lunch.id}`, owner.accessToken, { version: lunch.version, startTime: '12:30' });
    const ics = unfold((await call('GET', `/calendar/${token}.ics`)).body);
    expect(ics).toContain(`UID:item-${lunch.id}@tagalong\r\nSEQUENCE:2`);
    expect(ics).toContain('DTSTART;TZID=Europe/Lisbon:20261023T123000');
  });

  it('stops working when replaced or turned off, and knows no other tokens', async () => {
    const { owner } = await setup();
    const first = await startFeed(owner.accessToken);
    const second = await startFeed(owner.accessToken);
    expect((await call('GET', `/calendar/${first.token}.ics`)).statusCode).toBe(404);
    expect((await call('GET', `/calendar/${second.token}.ics`)).statusCode).toBe(200);
    expect((await call('DELETE', '/me/calendar', owner.accessToken)).statusCode).toBe(204);
    expect((await call('GET', `/calendar/${second.token}.ics`)).statusCode).toBe(404);
    expect((await call('GET', '/me/calendar', owner.accessToken)).json<CalendarFeed>().active).toBe(false);
    expect((await call('GET', '/calendar/not-a-real-token-at-all-0123456789.ics')).statusCode).toBe(404);
    expect((await call('GET', `/calendar/${second.token}`)).statusCode).toBe(404);
  });

  it('drops a trip someone was removed from', async () => {
    const { owner, tripId } = await setup();
    const sam = await joinTrip(ctx, tripId, owner.accessToken, 'sam@example.com');
    const { token } = await startFeed(sam.accessToken);
    expect((await call('GET', `/calendar/${token}.ics`)).body).toContain(`trip-${tripId}@tagalong`);
    expect((await call('DELETE', `/trips/${tripId}/members/${sam.userId}`, owner.accessToken)).statusCode).toBe(204);
    expect((await call('GET', `/calendar/${token}.ics`)).body).not.toContain(`trip-${tripId}@tagalong`);
  });

  it('downloads one trip as a file, for its members only', async () => {
    const { owner, tripId, lunch } = await setup();
    const stranger = await ctx.signIn('stranger@example.com');
    const res = await call('GET', `/trips/${tripId}/calendar.ics`, owner.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="Lisbon.ics"');
    expect(unfold(res.body)).toContain(`UID:item-${lunch.id}@tagalong`);
    expect((await call('GET', `/trips/${tripId}/calendar.ics`, stranger.accessToken)).statusCode).toBe(404);
  });
});
