import { z } from 'zod';
import { TRIP_ROLES } from '../roles';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const CreateTripInput = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120),
    destination: z.string().trim().min(1).max(200),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    baseCurrency: z.string().length(3).toUpperCase().default('EUR'),
    coverColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .default('#D8A47F'),
  })
  .refine((t) => !t.startDate || !t.endDate || t.startDate <= t.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type CreateTripInput = z.input<typeof CreateTripInput>;

/** `version` is the one you last saw; a mismatch means someone changed it since. */
export const UpdateTripInput = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    destination: z.string().trim().min(1).max(200).optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    baseCurrency: z.string().length(3).toUpperCase().optional(),
    coverColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    version: z.number().int().min(1),
  })
  .refine((t) => !t.startDate || !t.endDate || t.startDate <= t.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });
export type UpdateTripInput = z.input<typeof UpdateTripInput>;

export const TripMember = z.object({
  userId: z.string().uuid(),
  displayName: z.string(),
  role: z.enum(TRIP_ROLES),
  /** For paying them back through a UPI app. */
  upiId: z.string().nullable().default(null),
});
export type TripMember = z.infer<typeof TripMember>;

export const TripSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  destination: z.string(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  coverColor: z.string(),
  myRole: z.enum(TRIP_ROLES),
  memberCount: z.number().int(),
});
export type TripSummary = z.infer<typeof TripSummary>;

export const Trip = TripSummary.extend({
  /** The signed-in user's id, so screens can tell which member is "you". */
  myUserId: z.string().uuid(),
  baseCurrency: z.string().length(3),
  members: z.array(TripMember),
  version: z.number().int(),
});
export type Trip = z.infer<typeof Trip>;
