import { z } from 'zod';

export const BOOKING_TYPES = ['flight', 'stay', 'train', 'ticket', 'car', 'restaurant'] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

const field = (max = 100) => z.string().trim().max(max).optional();

/**
 * What each kind of booking records beyond the shared fields. A flight's seats
 * and a restaurant's party size have nothing in common, so they live in one
 * JSON column, but each type is still checked: `.strict()` refuses fields that
 * don't belong, so a typo can't quietly store junk.
 */
export const BOOKING_DETAILS = {
  flight: z
    .object({
      flightNumber: field(20),
      from: field(),
      to: field(),
      terminal: field(20),
      gate: field(20),
      seats: field(),
    })
    .strict(),
  stay: z.object({ address: field(300), room: field(), phone: field(40) }).strict(),
  train: z
    .object({
      trainNumber: field(20),
      from: field(),
      to: field(),
      coach: field(20),
      seats: field(),
    })
    .strict(),
  ticket: z.object({ venue: field(200), seats: field(), entrance: field() }).strict(),
  car: z.object({ pickup: field(200), dropoff: field(200) }).strict(),
  restaurant: z
    .object({
      address: field(300),
      partySize: z.number().int().min(1).max(100).optional(),
      phone: field(40),
    })
    .strict(),
} satisfies Record<BookingType, z.ZodTypeAny>;

export type BookingDetails = {
  [K in BookingType]: z.infer<(typeof BOOKING_DETAILS)[K]>;
};

/** Checks `details` against the rules for its booking type. */
export const parseBookingDetails = (type: BookingType, details: unknown) =>
  BOOKING_DETAILS[type].safeParse(details ?? {});

export const Booking = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  /** The plan item it belongs to. A booking can exist before it's on a day. */
  itemId: z.string().uuid().nullable(),
  /** The confirmation PDF or screenshot, from the Docs tab. */
  documentId: z.string().uuid().nullable(),
  type: z.enum(BOOKING_TYPES),
  provider: z.string().nullable(),
  /** The confirmation code: what you read out at the desk. */
  reference: z.string().nullable(),
  /** A real instant, unlike a plan item's local date and wall-clock time. */
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  /** Where the times should be shown, e.g. "Europe/Lisbon". */
  timezone: z.string(),
  details: z.record(z.unknown()),
  costMinor: z.number().int().nullable(),
  costCurrency: z.string().length(3).nullable(),
  createdBy: z.string().uuid(),
  version: z.number().int(),
  updatedAt: z.string(),
});
export type Booking = z.infer<typeof Booking>;

export const BookingList = z.object({ bookings: z.array(Booking) });

const instant = z.string().datetime({ offset: true, message: 'Use a full date and time' });

const editableFields = {
  itemId: z.string().uuid().nullable().optional(),
  documentId: z.string().uuid().nullable().optional(),
  provider: z.string().trim().max(100).nullable().optional(),
  reference: z.string().trim().max(60).nullable().optional(),
  startsAt: instant.nullable().optional(),
  endsAt: instant.nullable().optional(),
  timezone: z.string().min(1).max(64).optional(),
  details: z.record(z.unknown()).optional(),
  costMinor: z.number().int().min(0).max(100_000_000).nullable().optional(),
  costCurrency: z.string().length(3).toUpperCase().nullable().optional(),
};

const endsAfterStart = (b: { startsAt?: string | null; endsAt?: string | null }) =>
  !b.startsAt || !b.endsAt || new Date(b.endsAt) >= new Date(b.startsAt);

export const CreateBookingInput = z
  .object({
    ...editableFields,
    id: z.string().uuid().optional(),
    type: z.enum(BOOKING_TYPES),
    timezone: z.string().min(1).max(64).default('UTC'),
    details: z.record(z.unknown()).default({}),
  })
  .refine(endsAfterStart, { message: 'Ends before it starts', path: ['endsAt'] })
  .superRefine((b, ctx) => {
    const parsed = parseBookingDetails(b.type, b.details);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', path: ['details'], message: 'Those details don’t fit this kind of booking' });
    }
  });
export type CreateBookingInput = z.input<typeof CreateBookingInput>;

/** `version` is the one you last saw; a mismatch means someone changed it since. */
export const UpdateBookingInput = z
  .object({
    ...editableFields,
    type: z.enum(BOOKING_TYPES).optional(),
    version: z.number().int().min(1),
  })
  .refine(endsAfterStart, { message: 'Ends before it starts', path: ['endsAt'] });
export type UpdateBookingInput = z.input<typeof UpdateBookingInput>;

/** The next booking that hasn't started yet, for the trip overview. */
export const NextUp = z.object({
  booking: Booking.nullable(),
  /** The plan item's title, when the booking is on one. */
  itemTitle: z.string().nullable(),
});
export type NextUp = z.infer<typeof NextUp>;
