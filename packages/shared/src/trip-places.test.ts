import { describe, expect, it } from 'vitest';
import { dayRouteLinks } from './places';
import {
  dayPlaceLabel,
  placeDatesProblem,
  placeForDate,
  placeSegments,
  timezoneForStop,
  tripSummary,
  type PlaceColumns,
} from './trip-places';

const place = (destination: string, startDate: string | null = null, endDate: string | null = null) => ({
  destination,
  startDate,
  endDate,
});

const lisbon = place('Lisbon, Portugal', '2026-10-22', '2026-10-24');
const porto = place('Porto, Portugal', '2026-10-24', '2026-10-26');
const madrid = place('Madrid, Spain', '2026-10-28', '2026-10-29');
const trip = [lisbon, porto, madrid];

describe('placeForDate', () => {
  it('picks the place whose dates contain the day', () => {
    expect(placeForDate(trip, '2026-10-23')).toEqual({ place: lisbon, leaving: null });
    expect(placeForDate(trip, '2026-10-25')).toEqual({ place: porto, leaving: null });
    expect(placeForDate(trip, '2026-10-29')).toEqual({ place: madrid, leaving: null });
  });

  it('gives a travel day to both places, arriving last', () => {
    const day = placeForDate(trip, '2026-10-24')!;
    expect(day).toEqual({ place: porto, leaving: lisbon });
    expect(dayPlaceLabel(day)).toBe('Lisbon → Porto');
  });

  it('fills a gap with the nearest earlier place', () => {
    expect(placeForDate(trip, '2026-10-27')!.place).toBe(porto);
    expect(placeForDate(trip, '2026-11-02')!.place).toBe(madrid);
  });

  it('uses the first place before any dates, without dates, and for no day', () => {
    expect(placeForDate(trip, '2026-10-01')!.place).toBe(lisbon);
    expect(placeForDate([place('Goa'), place('Hampi')], '2026-10-23')!.place.destination).toBe('Goa');
    expect(placeForDate(trip, null)!.place).toBe(lisbon);
    expect(placeForDate([], '2026-10-23')).toBeNull();
  });

  it('treats a start without an end as that one day, then carries on as the nearest earlier', () => {
    const a = place('A', '2026-10-22');
    const b = place('B', '2026-10-25');
    expect(placeForDate([a, b], '2026-10-23')!.place).toBe(a);
    expect(placeForDate([a, b], '2026-10-25')!.place).toBe(b);
    expect(placeForDate([a, b], '2026-10-27')!.place).toBe(b);
  });

  it('labels an ordinary day with the city alone', () => {
    expect(dayPlaceLabel(placeForDate(trip, '2026-10-23')!)).toBe('Lisbon');
  });
});

describe('placeSegments', () => {
  it('splits a window into stretches per place, travel days going to the arrival', () => {
    const segments = placeSegments(trip, '2026-10-22', '2026-10-29');
    expect(segments.map((s) => [s.place.destination, s.from, s.to])).toEqual([
      ['Lisbon, Portugal', '2026-10-22', '2026-10-23'],
      ['Porto, Portugal', '2026-10-24', '2026-10-27'],
      ['Madrid, Spain', '2026-10-28', '2026-10-29'],
    ]);
  });
});

describe('placeDatesProblem', () => {
  const window = { startDate: '2026-10-22', endDate: '2026-10-29' };

  it('accepts places that meet on a travel day, and places without dates', () => {
    expect(placeDatesProblem(trip, window)).toBeNull();
    expect(placeDatesProblem([place('Goa'), place('Hampi')], { startDate: null, endDate: null })).toBeNull();
  });

  it('refuses overlapping places', () => {
    const overlapping = [lisbon, place('Porto, Portugal', '2026-10-23', '2026-10-26')];
    expect(placeDatesProblem(overlapping, window)).toMatch(/Lisbon and Porto overlap/);
  });

  it('refuses dates outside the trip, or without trip dates', () => {
    expect(placeDatesProblem([place('Lisbon', '2026-10-20', '2026-10-24')], window)).toMatch(/within the trip/);
    expect(placeDatesProblem([place('Lisbon', '2026-10-28', '2026-10-30')], window)).toMatch(/within the trip/);
    expect(placeDatesProblem([lisbon], { startDate: null, endDate: null })).toMatch(/trip’s dates/);
  });

  it('wants an arrival day when a leaving day is set', () => {
    expect(placeDatesProblem([place('Lisbon', null, '2026-10-24')], window)).toMatch(/day you arrive in Lisbon/);
  });
});

describe('tripSummary', () => {
  const columns = (destination: string, lat: number, lng: number, extra: Partial<PlaceColumns> = {}): PlaceColumns => ({
    destination,
    placeId: `osm:${destination}`,
    latitude: lat,
    longitude: lng,
    bounds: null,
    countryCode: 'PT',
    timezone: 'Europe/Lisbon',
    ...extra,
  });

  it('is the place itself for a one-place trip', () => {
    const only = columns('Lisbon, Portugal', 38.7, -9.1);
    expect(tripSummary([only])).toEqual(only);
  });

  it('joins the cities and covers them all', () => {
    const summary = tripSummary([
      columns('Lisbon, Portugal', 38.7, -9.1, { bounds: [-9.2, 38.6, -9.0, 38.8] }),
      columns('Porto, Portugal', 41.15, -8.6),
      columns('Madrid, Spain', 40.4, -3.7, { countryCode: 'ES', timezone: 'Europe/Madrid' }),
    ]);
    expect(summary).toMatchObject({
      destination: 'Lisbon → Porto → Madrid',
      placeId: 'osm:Lisbon, Portugal',
      timezone: 'Europe/Lisbon',
      countryCode: 'PT',
      bounds: [-9.2, 38.6, -3.7, 41.15],
    });
  });

  it('takes the spot from the first place on the map', () => {
    const free = { ...columns('Somewhere', 0, 0), latitude: null, longitude: null, placeId: null, timezone: null };
    expect(tripSummary([free, columns('Porto, Portugal', 41.15, -8.6)])).toMatchObject({
      destination: 'Somewhere → Porto',
      latitude: 41.15,
      timezone: 'Europe/Lisbon',
    });
  });
});

describe('timezoneForStop', () => {
  const zoned = [
    { ...lisbon, timezone: 'Europe/Lisbon', location: { latitude: 38.7, longitude: -9.1 } },
    { ...place('Madrid, Spain', '2026-10-24', '2026-10-26'), timezone: 'Europe/Madrid', location: { latitude: 40.4, longitude: -3.7 } },
  ];

  it('follows the day’s place', () => {
    expect(timezoneForStop(zoned, '2026-10-23')).toBe('Europe/Lisbon');
    expect(timezoneForStop(zoned, '2026-10-25')).toBe('Europe/Madrid');
  });

  it('on a travel day, uses the nearer place for a stop on the map, else the arrival', () => {
    expect(timezoneForStop(zoned, '2026-10-24', { latitude: 38.71, longitude: -9.14 })).toBe('Europe/Lisbon');
    expect(timezoneForStop(zoned, '2026-10-24', { latitude: 40.42, longitude: -3.7 })).toBe('Europe/Madrid');
    expect(timezoneForStop(zoned, '2026-10-24')).toBe('Europe/Madrid');
  });
});

describe('dayRouteLinks', () => {
  const at = (i: number) => ({ latitude: 38.7 + i / 100, longitude: -9.1 });

  it('opens the day as one route, in plan order, with the travel mode', () => {
    const { links, skipped } = dayRouteLinks([at(0), at(1), at(2)], 'foot');
    expect(skipped).toBe(0);
    expect(links).toHaveLength(1);
    const url = new URL(links[0]!.url);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('38.700000,-9.100000');
    expect(url.searchParams.get('waypoints')).toBe('38.710000,-9.100000');
    expect(url.searchParams.get('destination')).toBe('38.720000,-9.100000');
    expect(url.searchParams.get('travelmode')).toBe('walking');
    expect(links[0]!.url).toContain('origin=38.700000%2C-9.100000');
  });

  it('separates waypoints with an encoded bar, and names the other modes as Google does', () => {
    const { links } = dayRouteLinks([at(0), at(1), at(2), at(3)], 'bike');
    expect(links[0]!.url).toContain('waypoints=38.710000%2C-9.100000%7C38.720000%2C-9.100000');
    expect(links[0]!.url).toContain('travelmode=bicycling');
    expect(dayRouteLinks([at(0), at(1)], 'car').links[0]!.url).toContain('travelmode=driving');
  });

  it('skips stops that aren’t on the map, counting them, and numbers stops along the list', () => {
    const none = { latitude: null, longitude: null };
    const { links, skipped } = dayRouteLinks([none, at(0), none, at(1)], 'car');
    expect(skipped).toBe(2);
    expect(links).toEqual([expect.objectContaining({ fromStop: 2, toStop: 4 })]);
    expect(dayRouteLinks([at(0), none], 'car')).toEqual({ links: [], skipped: 1 });
  });

  it('splits a long day into parts of at most nine waypoints that meet at a stop', () => {
    const { links } = dayRouteLinks(Array.from({ length: 14 }, (_, i) => at(i)), 'foot');
    expect(links.map((l) => [l.fromStop, l.toStop])).toEqual([
      [1, 11],
      [11, 14],
    ]);
    const first = new URL(links[0]!.url);
    expect(first.searchParams.get('waypoints')!.split('|')).toHaveLength(9);
    expect(first.searchParams.get('destination')).toBe(new URL(links[1]!.url).searchParams.get('origin'));
    expect(dayRouteLinks(Array.from({ length: 11 }, (_, i) => at(i)), 'foot').links).toHaveLength(1);
  });
});
