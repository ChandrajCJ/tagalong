import { z } from 'zod';
import { RECOMMENDATION_CATEGORIES } from '../geo';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);

/** [west, south, east, north], the area a place covers. */
export const Bounds = z.tuple([lng, lat, lng, lat]);
export type Bounds = z.infer<typeof Bounds>;

/** One answer from the destination search. */
export const PlaceResult = z.object({
  /** Where it came from, e.g. "osm:R:11251493", so it can be looked up again. */
  id: z.string(),
  name: z.string(),
  /** "Goa, India" or "Lisbon, Portugal": what to show and store as the destination. */
  label: z.string(),
  /** "State", "City", "Town"… */
  kind: z.string().nullable(),
  countryCode: z.string().length(2).nullable(),
  latitude: lat,
  longitude: lng,
  bounds: Bounds.nullable(),
});
export type PlaceResult = z.infer<typeof PlaceResult>;

export const PlaceSearch = z.object({ results: z.array(PlaceResult) });

/** Where a trip is, once someone picked a real place for it. */
export const TripLocation = z.object({
  placeId: z.string().max(100),
  latitude: lat,
  longitude: lng,
  bounds: Bounds.nullable(),
  countryCode: z.string().length(2).toUpperCase().nullable(),
});
export type TripLocation = z.infer<typeof TripLocation>;

export const RecommendationCategory = z.enum(RECOMMENDATION_CATEGORIES);
export type RecommendationCategory = z.infer<typeof RecommendationCategory>;

/** Somewhere worth going, near the trip's destination. */
export const Recommendation = z.object({
  /** Stable per source: "wiki:12345" or "osm:node/678". */
  id: z.string(),
  name: z.string(),
  category: RecommendationCategory,
  /** A line or two about it, when Wikipedia has one. */
  description: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  /** The Wikipedia article or the place's own website. */
  url: z.string().url().nullable(),
  latitude: lat,
  longitude: lng,
  distanceKm: z.number(),
  /** "Restaurant", "Beach", "Museum"…, from OpenStreetMap. */
  kind: z.string().nullable(),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const RecommendationList = z.object({
  category: RecommendationCategory,
  places: z.array(Recommendation),
  /** Some sources didn't answer, so the list may be shorter than usual. */
  partial: z.boolean(),
  /** The destination is a region (a state, a country), so "km from the centre" means little. */
  region: z.boolean().default(false),
  /** Credit the data's owners, as their licences ask. */
  attribution: z.string(),
});
export type RecommendationList = z.infer<typeof RecommendationList>;

export const WeatherDay = z.object({
  date: z.string(),
  code: z.number().int(),
  maxC: z.number(),
  minC: z.number(),
  /** Chance of rain for forecasts; null for typical weather. */
  rainChance: z.number().nullable(),
  /** Rain that fell, for typical weather; null for forecasts. */
  rainMm: z.number().nullable(),
});
export type WeatherDay = z.infer<typeof WeatherDay>;

export const TripWeather = z.object({
  /** "forecast" for the coming two weeks, "typical" (last year's) beyond, "none" without a location or once over. */
  kind: z.enum(['forecast', 'typical', 'none']),
  timezone: z.string().nullable(),
  days: z.array(WeatherDay),
});
export type TripWeather = z.infer<typeof TripWeather>;
