import { eq } from 'drizzle-orm';
import { trips, type Db } from '@tagalong/db';
import {
  mergePlaces,
  sameDayLastYear,
  weatherPlan,
  type Bounds,
  type PlaceResult,
  type PlaceScope,
  type RecommendationCategory,
  type RecommendationList,
  type TripWeather,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { requireTripRole } from '../../lib/access';
import { badRequest, tooMany } from '../../lib/errors';
import type { Geo, GeoPlace, Point } from '../../lib/geo';

const DAY = 24 * 60 * 60;
const ATTRIBUTION = 'Places from Wikipedia and © OpenStreetMap contributors';
/** How far from the centre to look, at most, in degrees (about 40 km). */
const MAX_HALF_SPAN = 0.4;
/** How far to look when the search gave a point but no area. */
const DEFAULT_HALF_SPAN = 0.08;

/** The area to search: the destination's own, but never so big the free servers choke. */
export const searchArea = (centre: Point, bounds: Bounds | null): Bounds => {
  const clamp = (lo: number, hi: number, mid: number) => [Math.max(lo, mid - MAX_HALF_SPAN), Math.min(hi, mid + MAX_HALF_SPAN)];
  if (!bounds) {
    return [
      centre.longitude - DEFAULT_HALF_SPAN,
      centre.latitude - DEFAULT_HALF_SPAN,
      centre.longitude + DEFAULT_HALF_SPAN,
      centre.latitude + DEFAULT_HALF_SPAN,
    ];
  }
  const [w, e] = clamp(bounds[0], bounds[2], centre.longitude);
  const [s, n] = clamp(bounds[1], bounds[3], centre.latitude);
  return [w!, s!, e!, n!];
};

/** How far past the destination a plan's places may be: day trips included. */
const PLACE_MARGIN_KM = 30;

/** Where plan places are looked for: the destination's area, widened by about 30 km on every side. */
export const placeArea = (centre: Point, bounds: Bounds | null): Bounds => {
  const [w, s, e, n] = bounds ?? [centre.longitude, centre.latitude, centre.longitude, centre.latitude];
  const dLat = PLACE_MARGIN_KM / 111.32;
  const dLng = dLat / Math.max(Math.cos((centre.latitude * Math.PI) / 180), 0.1);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return [
    round(Math.max(w - dLng, -180)),
    round(Math.max(s - dLat, -90)),
    round(Math.min(e + dLng, 180)),
    round(Math.min(n + dLat, 90)),
  ];
};

/** A destination this wide is a region (a state, a country), not a town. */
const REGION_SPAN = 0.3;
export const isRegion = (bounds: Bounds | null) =>
  !!bounds && (bounds[2] - bounds[0] > REGION_SPAN || bounds[3] - bounds[1] > REGION_SPAN);

/**
 * Where to ask Wikipedia, which searches 10 km around a point: the centre for
 * a town, a 3×3 grid across a region, so a state's famous spots aren't missed
 * just because its middle is empty countryside.
 */
export const wikiPoints = (centre: Point, area: Bounds, region: boolean): Point[] => {
  if (!region) return [centre];
  const [w, s, e, n] = area;
  const points: Point[] = [];
  for (const fy of [1 / 6, 1 / 2, 5 / 6]) {
    for (const fx of [1 / 6, 1 / 2, 5 / 6]) {
      points.push({ latitude: s + (n - s) * fy, longitude: w + (e - w) * fx });
    }
  }
  return points;
};

const addYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;

export const createPlacesService = (db: Db, redis: Redis, geo: Geo) => {
  /** Reads a cached answer, or works it out and keeps it for `ttl` seconds. */
  const cached = async <T>(key: string, ttl: number, work: () => Promise<{ value: T; keep: boolean }>) => {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const { value, keep } = await work();
    if (keep) await redis.set(key, JSON.stringify(value), 'EX', ttl).catch(() => undefined);
    return value;
  };

  const locationOf = async (tripId: string) => {
    const [trip] = await db
      .select({
        latitude: trips.latitude,
        longitude: trips.longitude,
        bounds: trips.bounds,
        startDate: trips.startDate,
        endDate: trips.endDate,
        timezone: trips.timezone,
      })
      .from(trips)
      .where(eq(trips.id, tripId));
    return trip!;
  };

  return {
    /**
     * Destinations matching what someone typed or, in place scope, spots in
     * and around the trip's destination. A few searches a second at most, per person.
     */
    async search(
      query: string,
      userId: string,
      { near, scope = 'destination', tripId }: { near?: Point; scope?: PlaceScope; tripId?: string } = {},
    ): Promise<PlaceResult[]> {
      if (tripId) await requireTripRole(db, tripId, userId, 'viewer');
      // If Redis can't count (full, restarting), let the search through.
      const count = await redis.incr(`geo:rate:${userId}`).catch(() => 0);
      if (count === 1) await redis.expire(`geo:rate:${userId}`, 60).catch(() => undefined);
      if (count > 60) throw tooMany('Searching too fast. Wait a moment and try again.');

      let bbox: Bounds | undefined;
      if (scope === 'place' && tripId) {
        const trip = await locationOf(tripId);
        if (trip.latitude !== null && trip.longitude !== null) {
          near = { latitude: trip.latitude, longitude: trip.longitude };
          bbox = placeArea(near, trip.bounds ?? null);
        }
      }
      const spot = near ? `${near.latitude.toFixed(scope === 'place' ? 3 : 1)},${near.longitude.toFixed(scope === 'place' ? 3 : 1)}` : '';
      const key = `geo:search:${scope}:${query.toLowerCase()}:${spot}`;
      return cached(key, DAY, async () => ({ value: await geo.search(query, { near, scope, bbox }), keep: true }));
    },

    /** Places worth going to near the trip's destination, best known first. */
    async recommendations(tripId: string, userId: string, category: RecommendationCategory): Promise<RecommendationList> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const trip = await locationOf(tripId);
      if (trip.latitude === null || trip.longitude === null) {
        throw badRequest('Pick the destination from the suggestions to see places to go', 'no_location');
      }
      const centre = { latitude: trip.latitude, longitude: trip.longitude };
      const area = searchArea(centre, trip.bounds ?? null);
      const region = isRegion(trip.bounds ?? null);
      const spot = `${centre.latitude.toFixed(3)},${centre.longitude.toFixed(3)}${region ? ':region' : ''}`;

      return cached(`geo:recs:${category}:${spot}`, 7 * DAY, async () => {
        // Wikipedia's list serves every category, so it's fetched once per spot.
        const wikiAll = await cached(`geo:wiki:${spot}`, 7 * DAY, async () => {
          const answers = await Promise.all(
            wikiPoints(centre, area, region).map((point) => geo.wikipediaNearby(point).catch(() => null)),
          );
          const places = answers.every((a) => a === null) ? null : answers.flatMap((a) => a ?? []);
          return { value: places, keep: places !== null };
        });
        const osm = await geo.osmPlaces(area, category).catch(() => null);
        // "Sights" is the best of everything Wikipedia knows; other tabs, their own kind.
        const wiki = (wikiAll ?? []).filter((p) => category === 'sights' || p.category === category);
        const places = mergePlaces<GeoPlace>([wiki, osm ?? []], centre).map(({ score: _s, ...p }) => ({ ...p, category }));
        const partial = wikiAll === null || osm === null;
        // A partial answer is kept briefly, so a busy server gets another chance soon.
        const value = { category, places, partial, region, attribution: ATTRIBUTION };
        if (partial) await redis.set(`geo:recs:${category}:${spot}`, JSON.stringify(value), 'EX', 600).catch(() => undefined);
        return { value, keep: !partial };
      });
    },

    /** The forecast for the trip's days, or last year's weather on them when it's further out. */
    async weather(tripId: string, userId: string, today = new Date().toISOString().slice(0, 10)): Promise<TripWeather> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const trip = await locationOf(tripId);
      if (trip.latitude === null || trip.longitude === null) return { kind: 'none', timezone: trip.timezone, days: [] };
      const plan = weatherPlan(trip.startDate, trip.endDate, today);
      if (!plan) return { kind: 'none', timezone: trip.timezone, days: [] };
      const centre = { latitude: trip.latitude, longitude: trip.longitude };
      const key = `geo:weather:${plan.kind}:${centre.latitude.toFixed(2)},${centre.longitude.toFixed(2)}:${plan.from}:${plan.to}`;

      return cached<TripWeather>(key, plan.kind === 'forecast' ? 3 * 60 * 60 : 30 * DAY, async () => {
        if (plan.kind === 'forecast') {
          const w = await geo.weather(centre, 'forecast', plan.from, plan.to);
          return { value: { kind: 'forecast' as const, timezone: w.timezone, days: w.days }, keep: w.days.length > 0 };
        }
        // Last year's weather on the same dates, shown against this year's.
        const w = await geo.weather(centre, 'archive', sameDayLastYear(plan.from), sameDayLastYear(plan.to));
        const days = w.days.map((d) => ({ ...d, date: addYears(d.date, 1), rainChance: null }));
        return { value: { kind: 'typical' as const, timezone: w.timezone, days }, keep: days.length > 0 };
      });
    },
  };
};
