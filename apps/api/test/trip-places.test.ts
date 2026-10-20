import type { RecommendationList, Trip, TripPlace, TripWeather } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip as createPlainTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const inDays = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const LISBON = { placeId: 'osm:R:5400890', latitude: 38.7223, longitude: -9.1393, bounds: [-9.23, 38.69, -9.09, 38.8] as [number, number, number, number], countryCode: 'PT' };
const PORTO = { placeId: 'osm:R:3372453', latitude: 41.1579, longitude: -8.6291, bounds: null, countryCode: 'PT' };
const MADRID = { placeId: 'osm:R:5326784', latitude: 40.4168, longitude: -3.7038, bounds: null, countryCode: 'ES' };

const getTrip = async (token: string, id: string) =>
  (await ctx.app.inject({ method: 'GET', url: `/trips/${id}`, headers: bearer(token) })).json<Trip>();

/** Lisbon (days 2–4) → Porto (4–6) → Madrid (6–7), with their own time zones. */
const createTour = async (token: string) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/trips',
    headers: bearer(token),
    payload: {
      name: 'Iberia',
      destination: 'Lisbon → Porto → Madrid',
      startDate: inDays(2),
      endDate: inDays(7),
      places: [
        { destination: 'Lisbon, Portugal', location: LISBON, startDate: inDays(2), endDate: inDays(4) },
        { destination: 'Porto, Portugal', location: PORTO, startDate: inDays(4), endDate: inDays(6) },
        { destination: 'Madrid, Spain', location: MADRID, startDate: inDays(6), endDate: inDays(7) },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Trip>();
};

const addPlace = (token: string, tripId: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'POST', url: `/trips/${tripId}/places`, headers: bearer(token), payload });
const patchPlace = (token: string, tripId: string, placeId: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'PATCH', url: `/trips/${tripId}/places/${placeId}`, headers: bearer(token), payload });
const deletePlace = (token: string, tripId: string, placeId: string) =>
  ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/places/${placeId}`, headers: bearer(token) });

describe('trips with several places', () => {
  it('creates every place in order and sums them up on the trip', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    expect(trip.places.map((p) => [p.destination, p.startDate, p.endDate])).toEqual([
      ['Lisbon, Portugal', inDays(2), inDays(4)],
      ['Porto, Portugal', inDays(4), inDays(6)],
      ['Madrid, Spain', inDays(6), inDays(7)],
    ]);
    expect(trip).toMatchObject({
      destination: 'Lisbon → Porto → Madrid',
      location: { placeId: LISBON.placeId, latitude: LISBON.latitude, countryCode: 'PT', bounds: [-9.23, 38.69, -3.7038, 41.1579] },
    });
  });

  it('gives a trip from an older phone one place, its destination', async () => {
    const me = await ctx.signIn('priya@example.com');
    const id = await createPlainTrip(ctx.app, me.accessToken);
    const trip = await getTrip(me.accessToken, id);
    expect(trip.destination).toBe('Lisbon, Portugal');
    expect(trip.places).toEqual([expect.objectContaining({ destination: 'Lisbon, Portugal', location: null, startDate: null, version: 1 })]);
  });

  it('refuses overlapping places when creating, but allows a shared travel day', async () => {
    const me = await ctx.signIn('priya@example.com');
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/trips',
      headers: bearer(me.accessToken),
      payload: {
        name: 'Iberia',
        destination: 'Lisbon → Porto',
        startDate: inDays(2),
        endDate: inDays(7),
        places: [
          { destination: 'Lisbon, Portugal', startDate: inDays(2), endDate: inDays(5) },
          { destination: 'Porto, Portugal', startDate: inDays(4), endDate: inDays(7) },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Lisbon and Porto overlap/);
  });

  it('keeps each place’s own time zone, and the first one’s on the trip', async () => {
    const me = await ctx.signIn('priya@example.com');
    ctx.geo.answers.timezone = 'Europe/Lisbon';
    const id = (
      await ctx.app.inject({
        method: 'POST',
        url: '/trips',
        headers: bearer(me.accessToken),
        payload: { name: 'Iberia', destination: 'Lisbon, Portugal', location: LISBON },
      })
    ).json<Trip>().id;
    ctx.geo.answers.timezone = 'Europe/Madrid';
    const madrid = (await addPlace(me.accessToken, id, { destination: 'Madrid, Spain', location: MADRID })).json<TripPlace>();
    expect(madrid.timezone).toBe('Europe/Madrid');
    const trip = await getTrip(me.accessToken, id);
    expect(trip).toMatchObject({ timezone: 'Europe/Lisbon', destination: 'Lisbon → Madrid' });
  });
});

describe('the places API', () => {
  it('lets editors add, change, reorder and remove places, keeping the summary in step', async () => {
    const owner = await ctx.signIn('owner@example.com');
    const trip = await createTour(owner.accessToken);
    const editor = await joinTrip(ctx, trip.id, owner.accessToken, 'ed@example.com', 'editor');
    const [lisbon, porto, madrid] = trip.places;

    // Madrid first: a position before Lisbon's.
    const moved = await patchPlace(editor.accessToken, trip.id, madrid!.id, { version: madrid!.version, position: 'Zz' });
    expect(moved.statusCode).toBe(200);
    let now = await getTrip(owner.accessToken, trip.id);
    expect(now.destination).toBe('Madrid → Lisbon → Porto');
    expect(now.version).toBeGreaterThan(trip.version);

    const renamed = await patchPlace(editor.accessToken, trip.id, porto!.id, { version: porto!.version, destination: 'Oporto, Portugal', location: null });
    expect(renamed.json<TripPlace>()).toMatchObject({ destination: 'Oporto, Portugal', location: null, version: porto!.version + 1 });

    expect((await deletePlace(editor.accessToken, trip.id, lisbon!.id)).statusCode).toBe(204);
    now = await getTrip(owner.accessToken, trip.id);
    expect(now.destination).toBe('Madrid → Oporto');
    expect(now.location).toMatchObject({ placeId: MADRID.placeId });

    const list = await ctx.app.inject({ method: 'GET', url: `/trips/${trip.id}/places`, headers: bearer(editor.accessToken) });
    expect(list.json<{ places: TripPlace[] }>().places.map((p) => p.destination)).toEqual(['Madrid, Spain', 'Oporto, Portugal']);
  });

  it('lets viewers look but not change, and hides the trip from strangers', async () => {
    const owner = await ctx.signIn('owner@example.com');
    const trip = await createTour(owner.accessToken);
    const viewer = await joinTrip(ctx, trip.id, owner.accessToken, 'vi@example.com', 'viewer');
    const stranger = await ctx.signIn('stranger@example.com');
    const place = trip.places[0]!;

    expect((await ctx.app.inject({ method: 'GET', url: `/trips/${trip.id}/places`, headers: bearer(viewer.accessToken) })).statusCode).toBe(200);
    expect((await addPlace(viewer.accessToken, trip.id, { destination: 'Faro' })).statusCode).toBe(403);
    expect((await patchPlace(viewer.accessToken, trip.id, place.id, { version: place.version, destination: 'Nope' })).statusCode).toBe(403);
    expect((await deletePlace(viewer.accessToken, trip.id, place.id)).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'GET', url: `/trips/${trip.id}/places`, headers: bearer(stranger.accessToken) })).statusCode).toBe(404);
    expect((await addPlace(stranger.accessToken, trip.id, { destination: 'Faro' })).statusCode).toBe(404);
  });

  it('keeps at least one place', async () => {
    const me = await ctx.signIn('priya@example.com');
    const id = await createPlainTrip(ctx.app, me.accessToken);
    const [only] = (await getTrip(me.accessToken, id)).places;
    const res = await deletePlace(me.accessToken, id, only!.id);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'last_place' });
  });

  it('adds a place once, however often the phone retries', async () => {
    const me = await ctx.signIn('priya@example.com');
    const id = await createPlainTrip(ctx.app, me.accessToken);
    const placeId = '01900000-0000-7000-8000-000000000001';
    expect((await addPlace(me.accessToken, id, { id: placeId, destination: 'Sintra, Portugal' })).statusCode).toBe(201);
    expect((await addPlace(me.accessToken, id, { id: placeId, destination: 'Sintra, Portugal' })).statusCode).toBe(200);
    expect((await getTrip(me.accessToken, id)).places).toHaveLength(2);
  });

  it('refuses overlapping dates and dates outside the trip, with a clear message', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    const porto = trip.places[1]!;

    const overlap = await patchPlace(me.accessToken, trip.id, porto.id, { version: porto.version, startDate: inDays(3) });
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json().message).toMatch(/Lisbon and Porto overlap/);

    const outside = await addPlace(me.accessToken, trip.id, { destination: 'Faro, Portugal', startDate: inDays(7), endDate: inDays(9) });
    expect(outside.statusCode).toBe(400);
    expect(outside.json().message).toMatch(/Faro’s dates need to be within the trip’s dates/);

    // Madrid's last day is a fine travel day onwards.
    expect((await addPlace(me.accessToken, trip.id, { destination: 'Toledo, Spain', startDate: inDays(7), endDate: inDays(7) })).statusCode).toBe(201);
  });

  it('refuses a stale edit with the current place', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    const porto = trip.places[1]!;
    await patchPlace(me.accessToken, trip.id, porto.id, { version: porto.version, destination: 'Porto city' });
    const stale = await patchPlace(me.accessToken, trip.id, porto.id, { version: porto.version, destination: 'Porto again' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toMatchObject({ destination: 'Porto city' });
  });

  it('won’t shrink the trip’s dates past its places', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/trips/${trip.id}`,
      headers: bearer(me.accessToken),
      payload: { version: trip.version, endDate: inDays(5) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Porto’s dates need to be within the trip’s dates. Change the places’ dates first/);
  });

  it('turns an older phone’s destination edit into a change to the first place', async () => {
    const me = await ctx.signIn('priya@example.com');
    const id = await createPlainTrip(ctx.app, me.accessToken);
    const before = await getTrip(me.accessToken, id);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/trips/${id}`,
      headers: bearer(me.accessToken),
      payload: { version: before.version, destination: 'Porto, Portugal', location: PORTO },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Trip>()).toMatchObject({ destination: 'Porto, Portugal', location: { placeId: PORTO.placeId }, version: before.version + 1 });
    expect(res.json<Trip>().places).toEqual([expect.objectContaining({ destination: 'Porto, Portugal', location: expect.objectContaining({ placeId: PORTO.placeId }) })]);

    // Sending the same destination back (as the old edit screen always does) changes no place.
    const again = await ctx.app.inject({
      method: 'PATCH',
      url: `/trips/${id}`,
      headers: bearer(me.accessToken),
      payload: { version: before.version + 1, destination: 'Porto, Portugal', name: 'Porto weekend' },
    });
    expect(again.json<Trip>().places[0]!.version).toBe(res.json<Trip>().places[0]!.version);
  });
});

describe('what follows the day’s place', () => {
  it('asks for each stretch’s weather at its own place, labelled with the city', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    ctx.geo.answers.weather = { timezone: 'Europe/Lisbon', days: [{ date: inDays(2), code: 0, maxC: 22, minC: 14, rainChance: 0, rainMm: null }] };
    const w = (await ctx.app.inject({ method: 'GET', url: `/trips/${trip.id}/weather`, headers: bearer(me.accessToken) })).json<TripWeather>();
    expect(ctx.geo.spots.filter((s) => s.startsWith('weather'))).toEqual([
      `weather@${LISBON.latitude},${LISBON.longitude}:${inDays(2)}:${inDays(3)}`,
      `weather@${PORTO.latitude},${PORTO.longitude}:${inDays(4)}:${inDays(5)}`,
      `weather@${MADRID.latitude},${MADRID.longitude}:${inDays(6)}:${inDays(7)}`,
    ]);
    expect(w.days.map((d) => d.place)).toEqual(['Lisbon', 'Porto', 'Madrid']);
  });

  it('explores the place picked, or the first', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    const recs = (url: string) => ctx.app.inject({ method: 'GET', url, headers: bearer(me.accessToken) });
    await recs(`/trips/${trip.id}/recommendations?category=sights`);
    expect(ctx.geo.spots).toContain(`wiki@${LISBON.latitude},${LISBON.longitude}`);
    ctx.geo.spots.length = 0;
    const porto = await recs(`/trips/${trip.id}/recommendations?category=sights&place=${trip.places[1]!.id}`);
    expect(porto.json<RecommendationList>().category).toBe('sights');
    expect(ctx.geo.spots).toEqual([`wiki@${PORTO.latitude},${PORTO.longitude}`]);
    expect((await recs(`/trips/${trip.id}/recommendations?place=${'01900000-0000-7000-8000-000000000009'}`)).statusCode).toBe(400);
  });

  it('searches for a stop’s place around its day’s place', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTour(me.accessToken);
    const search = (query: string) =>
      ctx.app.inject({ method: 'GET', url: `/places/search?scope=place&tripId=${trip.id}&${query}`, headers: bearer(me.accessToken) });
    await search(`q=cafe&date=${inDays(5)}`);
    await search(`q=museum&place=${trip.places[2]!.id}`);
    await search('q=tram');
    expect(ctx.geo.searches.map((s) => s.near)).toEqual([
      { latitude: PORTO.latitude, longitude: PORTO.longitude },
      { latitude: MADRID.latitude, longitude: MADRID.longitude },
      { latitude: LISBON.latitude, longitude: LISBON.longitude },
    ]);
  });
});
