import type { Idea, PromoteResult, RecommendationList, Trip, TripWeather } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const GOA = {
  placeId: 'osm:R:11251493',
  latitude: 15.3004,
  longitude: 74.0855,
  bounds: [73.6756, 14.7529, 74.3361, 15.8008] as [number, number, number, number],
  countryCode: 'IN',
};

const createTrip = async (token: string, body: Record<string, unknown> = {}) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/trips',
    headers: bearer(token),
    payload: { name: 'Goa', destination: 'Goa, India', baseCurrency: 'INR', location: GOA, ...body },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Trip>();
};

const place = (id: string, name: string, category: 'sights' | 'food' | 'nature' | 'culture', score: number, lat = 15.5, lng = 73.8) => ({
  id,
  name,
  category,
  description: null,
  imageUrl: null,
  url: null,
  kind: null,
  latitude: lat,
  longitude: lng,
  score,
});

describe('destination search', () => {
  it('answers from the map search, and remembers answers for a while', async () => {
    const me = await ctx.signIn('priya@example.com');
    ctx.geo.answers.search = [
      { id: 'osm:R:1', name: 'Goa', label: 'Goa, India', kind: 'State', countryCode: 'IN', latitude: 15.3, longitude: 74.1, bounds: null, address: null },
    ];
    const ask = () => ctx.app.inject({ method: 'GET', url: '/places/search?q=goa', headers: bearer(me.accessToken) });
    expect((await ask()).json()).toEqual({ results: ctx.geo.answers.search });
    await ask();
    expect(ctx.geo.calls.filter((c) => c.startsWith('search'))).toHaveLength(1);
    expect(ctx.geo.searches[0]).toMatchObject({ scope: 'destination', bbox: undefined });
  });

  it('looks for places in and around the trip’s destination for the plan', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    ctx.geo.answers.search = [
      {
        id: 'osm:N:1',
        name: 'Fort Aguada',
        label: 'Fort Aguada, Goa, India',
        kind: 'Fort',
        countryCode: 'IN',
        latitude: 15.4925,
        longitude: 73.7732,
        bounds: null,
        address: 'Fort Aguada Road, Candolim',
      },
    ];
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/places/search?q=fort&scope=place&tripId=${trip.id}`,
      headers: bearer(me.accessToken),
    });
    expect(res.json()).toEqual({ results: ctx.geo.answers.search });
    const [asked] = ctx.geo.searches;
    expect(asked).toMatchObject({ query: 'fort', scope: 'place', near: { latitude: GOA.latitude, longitude: GOA.longitude } });
    // Goa's own area, widened by about 30 km on each side.
    const [w, s, e, n] = asked!.bbox!;
    expect(GOA.bounds[0] - w).toBeCloseTo(0.28, 1);
    expect(GOA.bounds[1] - s).toBeCloseTo(0.27, 1);
    expect(e - GOA.bounds[2]).toBeCloseTo(0.28, 1);
    expect(n - GOA.bounds[3]).toBeCloseTo(0.27, 1);
  });

  it('searches places only on trips you are on', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    const stranger = await ctx.signIn('stranger@example.com');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/places/search?q=fort&scope=place&tripId=${trip.id}`,
      headers: bearer(stranger.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('needs a sign-in and a couple of letters', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/places/search?q=goa' })).statusCode).toBe(401);
    const me = await ctx.signIn('priya@example.com');
    expect((await ctx.app.inject({ method: 'GET', url: '/places/search?q=g', headers: bearer(me.accessToken) })).statusCode).toBe(400);
  });
});

describe('a trip’s location', () => {
  it('is saved with the trip, with its time zone looked up', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    expect(trip.location).toEqual(GOA);
    expect(trip.timezone).toBe('Asia/Kolkata');
  });

  it('can be forgotten when the destination becomes free text', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/trips/${trip.id}`,
      headers: bearer(me.accessToken),
      payload: { version: trip.version, destination: 'Somewhere sunny', location: null },
    });
    expect(res.json<Trip>()).toMatchObject({ location: null, timezone: null, destination: 'Somewhere sunny' });
  });
});

describe('recommendations', () => {
  const recs = async (token: string, tripId: string, category = 'sights') =>
    ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/recommendations?category=${category}`, headers: bearer(token) });

  it('asks for a real destination first', async () => {
    const me = await ctx.signIn('priya@example.com');
    const res = await ctx.app.inject({ method: 'POST', url: '/trips', headers: bearer(me.accessToken), payload: { name: 'X', destination: 'Somewhere' } });
    const r = await recs(me.accessToken, res.json<Trip>().id);
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ error: 'no_location' });
  });

  it('merges Wikipedia and OpenStreetMap, best known first, without duplicates', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    ctx.geo.answers.wiki = [
      place('wiki:1', 'Fort Aguada', 'culture', 5, 15.4925, 73.7732),
      place('wiki:2', 'Baga Beach', 'nature', 4, 15.556, 73.751),
    ];
    ctx.geo.answers.osm = [
      place('osm:way/1', 'Fort Aguada', 'sights', 2, 15.4927, 73.7735),
      place('osm:node/2', 'Mapusa Market', 'sights', 1),
    ];
    const list = (await recs(me.accessToken, trip.id)).json<RecommendationList>();
    expect(list.partial).toBe(false);
    expect(list.places.map((p) => p.id)).toEqual(['wiki:1', 'wiki:2', 'osm:node/2']);
    expect(list.places.every((p) => p.category === 'sights')).toBe(true);
    expect(list.attribution).toContain('OpenStreetMap');
    expect(list.region).toBe(true);
  });

  it('shows only that kind of Wikipedia place in other categories', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    ctx.geo.answers.wiki = [place('wiki:1', 'Fort Aguada', 'culture', 5), place('wiki:2', 'Baga Beach', 'nature', 4, 15.556, 73.751)];
    ctx.geo.answers.osm = [];
    const list = (await recs(me.accessToken, trip.id, 'nature')).json<RecommendationList>();
    expect(list.places.map((p) => p.name)).toEqual(['Baga Beach']);
  });

  it('says when a source didn’t answer, and still shows the rest', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    ctx.geo.answers.wiki = [place('wiki:1', 'Fort Aguada', 'culture', 5)];
    ctx.geo.answers.osm = null;
    const list = (await recs(me.accessToken, trip.id)).json<RecommendationList>();
    expect(list).toMatchObject({ partial: true, places: [{ name: 'Fort Aguada' }] });
  });

  it('keeps answers for a week, so the free services are asked rarely', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    ctx.geo.answers.osm = [place('osm:node/2', 'Mapusa Market', 'sights', 1)];
    await recs(me.accessToken, trip.id);
    const wikiCalls = ctx.geo.calls.filter((c) => c === 'wiki').length;
    await recs(me.accessToken, trip.id);
    await recs(me.accessToken, trip.id, 'food');
    // Goa is a whole state, so Wikipedia is asked across a grid of points, once.
    expect(wikiCalls).toBe(9);
    expect(ctx.geo.calls.filter((c) => c === 'wiki')).toHaveLength(9);
    expect(ctx.geo.calls.filter((c) => c.startsWith('osm:'))).toEqual(['osm:sights', 'osm:food']);
  });

  it('are for people on the trip, viewers included', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    const viewer = await joinTrip(ctx, trip.id, me.accessToken, 'sam@example.com', 'viewer');
    expect((await recs(viewer.accessToken, trip.id)).statusCode).toBe(200);
    const stranger = await ctx.signIn('stranger@example.com');
    expect((await recs(stranger.accessToken, trip.id)).statusCode).toBe(404);
  });
});

describe('weather', () => {
  const weather = async (token: string, tripId: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/weather`, headers: bearer(token) })).json<TripWeather>();
  const inDays = (n: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  it('forecasts the trip’s days when they’re within two weeks', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken, { startDate: inDays(2), endDate: inDays(4) });
    ctx.geo.answers.weather = { timezone: 'Asia/Kolkata', days: [{ date: inDays(2), code: 0, maxC: 31, minC: 24, rainChance: 10, rainMm: null }] };
    const w = await weather(me.accessToken, trip.id);
    expect(w).toMatchObject({ kind: 'forecast', days: [{ maxC: 31 }] });
    expect(ctx.geo.calls).toContain(`weather:forecast:${inDays(2)}:${inDays(4)}`);
  });

  it('shows last year’s weather on the same dates for a trip further out', async () => {
    const me = await ctx.signIn('priya@example.com');
    const start = inDays(60);
    const trip = await createTrip(me.accessToken, { startDate: start, endDate: start });
    const lastYear = `${Number(start.slice(0, 4)) - 1}${start.slice(4)}`;
    ctx.geo.answers.weather = { timezone: 'Asia/Kolkata', days: [{ date: lastYear, code: 61, maxC: 29, minC: 23, rainChance: null, rainMm: 12 }] };
    const w = await weather(me.accessToken, trip.id);
    expect(w).toMatchObject({ kind: 'typical', days: [{ date: start, rainMm: 12 }] });
  });

  it('has nothing to say without a location', async () => {
    const me = await ctx.signIn('priya@example.com');
    const res = await ctx.app.inject({ method: 'POST', url: '/trips', headers: bearer(me.accessToken), payload: { name: 'X', destination: 'Somewhere' } });
    expect(await weather(me.accessToken, res.json<Trip>().id)).toMatchObject({ kind: 'none', days: [] });
  });
});

describe('ideas from Explore', () => {
  it('keep their location and photo, and pass the location on to the plan', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    const idea = (
      await ctx.app.inject({
        method: 'POST',
        url: `/trips/${trip.id}/ideas`,
        headers: bearer(me.accessToken),
        payload: {
          title: 'Fort Aguada',
          note: 'A 17th-century Portuguese fort.',
          url: 'https://en.wikipedia.org/?curid=1',
          latitude: 15.4925,
          longitude: 73.7732,
          placeRef: 'wiki:1',
          imageUrl: 'https://upload.wikimedia.org/fort.jpg',
        },
      })
    ).json<Idea>();
    expect(idea).toMatchObject({ latitude: 15.4925, placeRef: 'wiki:1', imageUrl: 'https://upload.wikimedia.org/fort.jpg' });

    const promoted = (
      await ctx.app.inject({ method: 'POST', url: `/ideas/${idea.id}/promote`, headers: bearer(me.accessToken), payload: { date: null } })
    ).json<PromoteResult>();
    expect(promoted.item).toMatchObject({ latitude: 15.4925, longitude: 73.7732, placeRef: 'wiki:1' });
  });

  it('are added once per trip, however many people tap Add', async () => {
    const me = await ctx.signIn('priya@example.com');
    const trip = await createTrip(me.accessToken);
    const add = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/trips/${trip.id}/ideas`,
        headers: bearer(me.accessToken),
        payload: { title: 'Baga Beach', latitude: 15.556, longitude: 73.751, placeRef: 'wiki:2' },
      });
    const first = await add();
    const second = await add();
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json<Idea>().id).toBe(first.json<Idea>().id);
  });
});
