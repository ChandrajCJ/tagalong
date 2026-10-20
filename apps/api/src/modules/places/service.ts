import { eq } from 'drizzle-orm';
import { trips, type Db } from '@tagalong/db';
import {
  mergePlaces,
  placeForDate,
  sameDayLastYear,
  weatherStretches,
  type Bounds,
  type PlaceResult,
  type PlaceScope,
  type RecommendationCategory,
  type RecommendationList,
  type TripWeather,
  type WeatherDay,
  type WeatherStretch,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { requireTripRole } from '../../lib/access';
import { badRequest, HttpError, tooMany } from '../../lib/errors';
import { PHOTON_TAGS, type Geo, type GeoPlace, type Point } from '../../lib/geo';
import { placeRows } from '../trips/places';

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

/** Half the width of a box around a busy spot, in degrees (about 6.5 km). */
const SPOT_HALF_SPAN = 0.06;
/** How many boxes to ask Overpass about for a region: enough for the busy places, few enough to answer. */
const MAX_SPOTS = 4;

/**
 * Where to ask Overpass. A town is one question; a region (a whole state) is
 * too big a question for the free servers, which time out on it, so it's a
 * few small boxes around its busiest spots: the centre and the best-known
 * Wikipedia places, at least 10 km apart.
 */
export const overpassBoxes = (centre: Point, area: Bounds, region: boolean, known: GeoPlace[]): Bounds[] => {
  if (!region) return [area];
  const spots: Point[] = [centre];
  for (const place of [...known].sort((a, b) => b.score - a.score)) {
    if (spots.length >= MAX_SPOTS) break;
    const far = spots.every((s) => Math.hypot(s.latitude - place.latitude, s.longitude - place.longitude) > 0.09);
    if (far) spots.push(place);
  }
  const [w, s, e, n] = area;
  return spots.map((p): Bounds => [
    Math.max(w, p.longitude - SPOT_HALF_SPAN),
    Math.max(s, p.latitude - SPOT_HALF_SPAN),
    Math.min(e, p.longitude + SPOT_HALF_SPAN),
    Math.min(n, p.latitude + SPOT_HALF_SPAN),
  ]);
};

const addYears = (iso: string, years: number) => `${Number(iso.slice(0, 4)) + years}${iso.slice(4)}`;

export const createPlacesService = (
  db: Db,
  redis: Redis,
  geo: Geo,
  /** How long to wait before quietly asking again after a partial answer; 0 never does (tests). */
  retryPartialMs = 0,
) => {
  /** Reads a cached answer, or works it out and keeps it for `ttl` seconds. */
  const cached = async <T>(key: string, ttl: number, work: () => Promise<{ value: T; keep: boolean }>) => {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
    const { value, keep } = await work();
    if (keep) await redis.set(key, JSON.stringify(value), 'EX', ttl).catch(() => undefined);
    return value;
  };

  const tripOf = async (tripId: string) => {
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

  /**
   * Where to look on a trip: the place asked for by id, or the place of a
   * day (a stop on the Porto day searches around Porto), or the first.
   * Falls back to the trip's summary when that place isn't on the map.
   */
  const placeOf = async (tripId: string, which: { placeId?: string; date?: string } = {}) => {
    const places = await placeRows(db, tripId);
    const chosen = which.placeId
      ? places.find((p) => p.id === which.placeId)
      : placeForDate(places, which.date ?? null)?.place;
    if (which.placeId && !chosen) throw badRequest('That place isn’t on this trip');
    if (chosen && chosen.latitude !== null && chosen.longitude !== null) {
      return { latitude: chosen.latitude, longitude: chosen.longitude, bounds: chosen.bounds };
    }
    const trip = await tripOf(tripId);
    return { latitude: trip.latitude, longitude: trip.longitude, bounds: trip.bounds };
  };

  /** One stretch of days at one place: the forecast, or last year's weather dated this year. */
  const stretchWeather = (kind: 'forecast' | 'typical', s: WeatherStretch) => {
    const key = `geo:weather:${kind}:${s.centre.latitude.toFixed(2)},${s.centre.longitude.toFixed(2)}:${s.from}:${s.to}${s.place ? `:${s.place}` : ''}`;
    return cached<WeatherDay[]>(key, kind === 'forecast' ? 3 * 60 * 60 : 30 * DAY, async () => {
      if (kind === 'forecast') {
        const w = await geo.weather(s.centre, 'forecast', s.from, s.to);
        return { value: w.days.map((d) => ({ ...d, place: s.place })), keep: w.days.length > 0 };
      }
      const w = await geo.weather(s.centre, 'archive', sameDayLastYear(s.from), sameDayLastYear(s.to));
      const days = w.days.map((d) => ({ ...d, date: addYears(d.date, 1), rainChance: null, place: s.place }));
      return { value: days, keep: days.length > 0 };
    });
  };

  return {
    /**
     * Destinations matching what someone typed or, in place scope, spots in
     * and around the trip's destination. A few searches a second at most, per person.
     */
    async search(
      query: string,
      userId: string,
      {
        near,
        scope = 'destination',
        tripId,
        placeId,
        date,
      }: { near?: Point; scope?: PlaceScope; tripId?: string; placeId?: string; date?: string } = {},
    ): Promise<PlaceResult[]> {
      if (tripId) await requireTripRole(db, tripId, userId, 'viewer');
      // If Redis can't count (full, restarting), let the search through.
      const count = await redis.incr(`geo:rate:${userId}`).catch(() => 0);
      if (count === 1) await redis.expire(`geo:rate:${userId}`, 60).catch(() => undefined);
      if (count > 60) throw tooMany('Searching too fast. Wait a moment and try again.');

      let bbox: Bounds | undefined;
      if (scope === 'place' && tripId) {
        // Around the stop's day's place, or the place picked in Explore.
        const trip = await placeOf(tripId, { placeId, date });
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
    async recommendations(
      tripId: string,
      userId: string,
      category: RecommendationCategory,
      placeId?: string,
    ): Promise<RecommendationList> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const trip = await placeOf(tripId, { placeId });
      if (trip.latitude === null || trip.longitude === null) {
        throw badRequest('Pick the destination from the suggestions to see places to go', 'no_location');
      }
      const centre = { latitude: trip.latitude, longitude: trip.longitude };
      const area = searchArea(centre, trip.bounds ?? null);
      const region = isRegion(trip.bounds ?? null);
      const spot = `${centre.latitude.toFixed(3)},${centre.longitude.toFixed(3)}${region ? ':region' : ''}`;

      // "v2": answers cached before Photon joined (often empty food lists) are left to expire.
      const key = `geo:recs:v2:${category}:${spot}`;
      const work = async (): Promise<RecommendationList> => {
        // Wikipedia's list serves every category, so it's fetched once per spot.
        const wikiAll = await cached(`geo:wiki:${spot}`, 7 * DAY, async () => {
          const answers = await Promise.all(
            wikiPoints(centre, area, region).map((point) => geo.wikipediaNearby(point).catch(() => null)),
          );
          const places = answers.every((a) => a === null) ? null : answers.flatMap((a) => a ?? []);
          return { value: places, keep: places !== null };
        });
        const boxes = overpassBoxes(centre, area, region, wikiAll ?? []);
        const osmAnswers = await Promise.all(boxes.map((box) => geo.osmPlaces(box, category).catch(() => null)));
        const osm = osmAnswers.every((a) => a === null) ? null : osmAnswers.flatMap((a) => a ?? []);
        // Food, nightlife and shopping also ask Photon, which answers when Overpass is busy.
        const usesPhoton = !!PHOTON_TAGS[category];
        const photon = usesPhoton ? await geo.photonPlaces(area, category).catch(() => null) : [];

        const failed = [wikiAll === null && 'wikipedia', osm === null && 'overpass', photon === null && 'photon'].filter(
          (x): x is string => !!x,
        );
        if (failed.length > 0) console.warn('Explore sources failed', { category, spot, failed });
        if (wikiAll === null && osm === null && (photon === null || !usesPhoton)) {
          throw new HttpError(503, 'places_unavailable', 'Couldn’t load places right now. Try again.');
        }
        // "Sights" is the best of everything Wikipedia knows; other tabs, their own kind.
        const wiki = (wikiAll ?? []).filter((p) => category === 'sights' || p.category === category);
        const places = mergePlaces<GeoPlace>([wiki, osm ?? [], photon ?? []], centre).map(({ score: _s, ...p }) => ({
          ...p,
          category,
        }));
        return { category, places, partial: failed.length > 0, region, attribution: ATTRIBUTION };
      };

      return cached(key, 7 * DAY, async () => {
        const value = await work();
        if (value.partial) {
          // Kept briefly, and asked again in the background, so the next visit is likely whole.
          await redis.set(key, JSON.stringify(value), 'EX', 600).catch(() => undefined);
          if (retryPartialMs > 0) {
            setTimeout(() => {
              void work()
                .then((again) => (again.partial ? undefined : redis.set(key, JSON.stringify(again), 'EX', 7 * DAY)))
                .catch(() => undefined);
            }, retryPartialMs).unref();
          }
        }
        return { value, keep: !value.partial };
      });
    },

    /**
     * The forecast for the trip's days, or last year's weather on them when
     * it's further out. Each day uses that day's place.
     */
    async weather(tripId: string, userId: string, today = new Date().toISOString().slice(0, 10)): Promise<TripWeather> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const trip = await tripOf(tripId);
      const places = await placeRows(db, tripId);
      const wanted = weatherStretches(trip, places, today);
      if (!wanted) return { kind: 'none', timezone: trip.timezone, days: [] };
      const days = await Promise.all(wanted.stretches.map((s) => stretchWeather(wanted.kind, s)));
      return { kind: wanted.kind, timezone: trip.timezone, days: days.flat() };
    },
  };
};
