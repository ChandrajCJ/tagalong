import { z } from 'zod';
import { TRAVEL_MODES } from '../route';
import { ItineraryItem } from './itinerary';

export const TravelMode = z.enum(TRAVEL_MODES);
export type TravelMode = z.infer<typeof TravelMode>;

/** Getting from one plan item to the next one. */
export const RouteLeg = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  distanceM: z.number(),
  durationS: z.number(),
});
export type RouteLeg = z.infer<typeof RouteLeg>;

/** A line on the map, as GeoJSON: [longitude, latitude] pairs. */
export const RouteLine = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});
export type RouteLine = z.infer<typeof RouteLine>;

/** Travel through a day's stops in plan order. */
export const DayRoute = z.object({
  mode: TravelMode,
  /** Only between two stops next to each other that both have a location. */
  legs: z.array(RouteLeg),
  totalDistanceM: z.number(),
  totalDurationS: z.number(),
  geometry: RouteLine.nullable(),
  /** The routing server didn't answer, so these are rough guesses ("about"). */
  estimated: z.boolean(),
});
export type DayRoute = z.infer<typeof DayRoute>;

/** "Shortest order": a suggestion only, until someone applies it. */
export const DayOptimisation = z.object({
  mode: TravelMode,
  /** Every item on the day, in the suggested order. */
  itemIds: z.array(z.string().uuid()),
  beforeS: z.number(),
  afterS: z.number(),
  savedS: z.number(),
  estimated: z.boolean(),
});
export type DayOptimisation = z.infer<typeof DayOptimisation>;

/** A new order for a whole day, with the version of each item as you last saw it. */
export const ReorderDayInput = z.object({
  itemIds: z.array(z.string().uuid()).min(1).max(200),
  versions: z.record(z.string().uuid(), z.number().int().min(1)),
});
export type ReorderDayInput = z.infer<typeof ReorderDayInput>;

export const DayItems = z.object({ items: z.array(ItineraryItem) });

/** The `day.reordered` event: the date and the items that moved. */
export const DayReordered = z.object({ date: z.string(), items: z.array(ItineraryItem) });
export type DayReordered = z.infer<typeof DayReordered>;
