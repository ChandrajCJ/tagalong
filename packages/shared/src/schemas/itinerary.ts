import { z } from 'zod';
import { TripDay } from './lists';

export const ITEM_TYPES = ['activity', 'meal', 'transport', 'stay', 'flight', 'other'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
/** 24-hour "HH:MM". */
export const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30 or 18:00');

export const ItineraryItem = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  date: isoDate.nullable(),
  startTime: clockTime.nullable(),
  endTime: clockTime.nullable(),
  position: z.string(),
  type: z.enum(ITEM_TYPES),
  title: z.string(),
  notes: z.string().nullable(),
  placeName: z.string().nullable(),
  costEstimateMinor: z.number().int().nullable(),
  costCurrency: z.string().length(3).nullable(),
  /** Where it is, when known, for the trip map. */
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null),
  placeRef: z.string().nullable().default(null),
  /** Someone said this stop needs no place, so the plan stops suggesting one. */
  placeHintDismissed: z.boolean().default(false),
  createdBy: z.string().uuid(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type ItineraryItem = z.infer<typeof ItineraryItem>;

/** The plan, with each day's own title and note where someone wrote one. */
export const ItemList = z.object({ items: z.array(ItineraryItem), days: z.array(TripDay).default([]) });

const editableFields = {
  date: isoDate.nullable().optional(),
  startTime: clockTime.nullable().optional(),
  endTime: clockTime.nullable().optional(),
  type: z.enum(ITEM_TYPES).optional(),
  title: z.string().trim().min(1, 'Give it a name').max(200).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  placeName: z.string().trim().max(200).nullable().optional(),
  costEstimateMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  costCurrency: z.string().length(3).toUpperCase().nullable().optional(),
  position: z.string().min(1).max(100).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  placeRef: z.string().max(100).nullable().optional(),
  placeHintDismissed: z.boolean().optional(),
};

export const CreateItemInput = z.object({
  ...editableFields,
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1, 'Give it a name').max(200),
  type: z.enum(ITEM_TYPES).default('activity'),
});
export type CreateItemInput = z.input<typeof CreateItemInput>;

/** `version` is the one you last saw; a mismatch means someone changed it since. */
export const UpdateItemInput = z.object({
  ...editableFields,
  version: z.number().int().min(1),
});
export type UpdateItemInput = z.input<typeof UpdateItemInput>;
