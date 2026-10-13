import { z } from 'zod';
import { BOOKING_TYPES, CreateBookingInput } from './bookings';

/** Where an import came from: forwarded to the trip's inbox, pasted in, or read from a file in Docs. */
export const IMPORT_SOURCES = ['email', 'paste', 'document'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_STATUSES = ['pending', 'added', 'dismissed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** How sure the parser is: structured data in the email is "high"; text guesses are lower. */
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** A booking as the parser found it: the fields of a new booking, nothing saved yet. */
export const BookingDraft = z.object({
  type: z.enum(BOOKING_TYPES),
  provider: z.string().nullable(),
  reference: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  timezone: z.string(),
  details: z.record(z.union([z.string(), z.number()])),
  costMinor: z.number().int().nullable(),
  costCurrency: z.string().length(3).nullable(),
});
export type BookingDraft = z.infer<typeof BookingDraft>;

export const BookingCandidate = z.object({
  booking: BookingDraft,
  confidence: z.enum(CONFIDENCES),
  /** Which fields were found, e.g. ["reference", "flightNumber", "startsAt"]. */
  found: z.array(z.string()),
  /** "open" until someone adds it or says "Not this". */
  state: z.enum(['open', 'added', 'skipped']).default('open'),
  /** The booking it became. */
  bookingId: z.string().uuid().nullable().default(null),
});
export type BookingCandidate = z.infer<typeof BookingCandidate>;

/** One email (or paste, or file) and the bookings found in it, waiting for review. */
export const BookingImport = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  source: z.enum(IMPORT_SOURCES),
  /** Who pasted it or forwarded it, when they're on the trip. */
  createdBy: z.string().uuid().nullable(),
  fromAddress: z.string().nullable(),
  subject: z.string().nullable(),
  receivedAt: z.string(),
  status: z.enum(IMPORT_STATUSES),
  candidates: z.array(BookingCandidate),
  /** The ticket PDF it came with, saved to Docs. */
  documentId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type BookingImport = z.infer<typeof BookingImport>;

export const ImportList = z.object({ imports: z.array(BookingImport) });

/** Paste an email's text, or point at a PDF or screenshot already in Docs. */
export const CreateImportInput = z
  .object({
    id: z.string().uuid().optional(),
    text: z.string().max(200_000, 'That’s too long. Paste just the confirmation email.').optional(),
    documentId: z.string().uuid().optional(),
  })
  .refine((v) => (v.text?.trim() ? 1 : 0) + (v.documentId ? 1 : 0) === 1, {
    message: 'Paste the email, or pick a file from Docs',
    path: ['text'],
  });
export type CreateImportInput = z.input<typeof CreateImportInput>;

/** Adds one candidate as a booking, with whatever the person corrected. */
export const AddImportInput = z.object({
  candidateIndex: z.number().int().min(0),
  booking: CreateBookingInput,
  /** Also put it in the plan as a new item on its day (unless the booking names an item already). */
  addToPlan: z.boolean().default(true),
});
export type AddImportInput = z.input<typeof AddImportInput>;

/** "Not this": one candidate, or the whole import when no index is given. */
export const DismissImportInput = z.object({ candidateIndex: z.number().int().min(0).optional() });
export type DismissImportInput = z.input<typeof DismissImportInput>;

/** What adding answers: the import as it is now, and the new booking's id. */
export const ImportAdded = z.object({
  import: BookingImport,
  bookingId: z.string().uuid(),
  /** The plan item it went on, if any. */
  itemId: z.string().uuid().nullable(),
});

/** The trip's forwarding address, or null when the server has no inbox set up. */
export const TripInbox = z.object({ address: z.string().nullable() });
export type TripInbox = z.infer<typeof TripInbox>;
