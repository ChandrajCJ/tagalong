import { z } from 'zod';
import { TRIP_ROLES } from '../roles';
import { TripLocation } from './places';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** At most this many places on one trip: a long rail trip, not a world tour. */
export const MAX_TRIP_PLACES = 12;

/** One city or region on a trip (Lisbon → Porto → Madrid), in trip order. */
export const TripPlace = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  /** A fractional-index key: sorting these strings gives the trip's order. */
  position: z.string(),
  /** "Lisbon, Portugal": what was picked or typed. */
  destination: z.string(),
  /** Where it is, when a real place was picked. */
  location: TripLocation.nullable(),
  timezone: z.string().nullable(),
  /** The days spent there, inside the trip's dates. Optional: without them, the first place is used. */
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  version: z.number().int(),
});
export type TripPlace = z.infer<typeof TripPlace>;

export const TripPlaceList = z.object({ places: z.array(TripPlace) });

const placeDates = <T extends { startDate?: string | null; endDate?: string | null }>(p: T) =>
  !p.startDate || !p.endDate || p.startDate <= p.endDate;
const placeDatesIssue = { message: 'Leaving must be on or after arriving', path: ['endDate'] };

/** A place as typed into New trip, before the trip exists. */
export const NewTripPlace = z
  .object({
    id: z.string().uuid().optional(),
    destination: z.string().trim().min(1).max(200),
    location: TripLocation.nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
  })
  .refine(placeDates, placeDatesIssue);
export type NewTripPlace = z.input<typeof NewTripPlace>;

/** POST /trips/:id/places. Without a position it goes last. */
export const CreateTripPlaceInput = z
  .object({
    id: z.string().uuid().optional(),
    destination: z.string().trim().min(1).max(200),
    location: TripLocation.nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    position: z.string().min(1).max(100).optional(),
  })
  .refine(placeDates, placeDatesIssue);
export type CreateTripPlaceInput = z.input<typeof CreateTripPlaceInput>;

/** PATCH /trips/:id/places/:placeId. `version` is the one you last saw. */
export const UpdateTripPlaceInput = z
  .object({
    destination: z.string().trim().min(1).max(200).optional(),
    /** A newly picked place, or null to forget it (the name became free text). */
    location: TripLocation.nullable().optional(),
    startDate: isoDate.nullable().optional(),
    endDate: isoDate.nullable().optional(),
    position: z.string().min(1).max(100).optional(),
    version: z.number().int().min(1),
  })
  .refine(placeDates, placeDatesIssue);
export type UpdateTripPlaceInput = z.input<typeof UpdateTripPlaceInput>;

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
    /** The real place picked from the destination search, if any. */
    location: TripLocation.optional(),
    /**
     * Every place on the trip, in order, when there's more than one (or the
     * one has dates). Replaces `destination` and `location`, which older
     * phones still send on their own.
     */
    places: z.array(NewTripPlace).min(1).max(MAX_TRIP_PLACES).optional(),
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
    /** A newly picked place, or null to forget it (the destination became free text). */
    location: TripLocation.nullable().optional(),
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
  /** When they joined, so a message's ticks only wait for people who were there. */
  joinedAt: z.string().nullable().default(null),
});
export type TripMember = z.infer<typeof TripMember>;

export const TripSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  destination: z.string(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  coverColor: z.string(),
  /** A short-lived link to the cover photo, when there is one; the colour shows behind and without it. */
  coverUrl: z.string().url().nullable().default(null),
  /** Credit for a cover from Wikipedia, shown small on the photo. */
  coverCredit: z.string().nullable().default(null),
  myRole: z.enum(TRIP_ROLES),
  memberCount: z.number().int(),
  /** I archived it: it sits under "Archived" in my list only. */
  archived: z.boolean().default(false),
  /** Main-chat messages from others since I last read it. */
  unreadCount: z.number().int().default(0),
});
export type TripSummary = z.infer<typeof TripSummary>;

/** How long an owner has to restore a deleted trip before it's gone for good. */
export const TRIP_RESTORE_DAYS = 30;

/** A trip its owner deleted, still restorable until `purgeAt`. */
export const DeletedTrip = z.object({
  id: z.string().uuid(),
  name: z.string(),
  destination: z.string(),
  coverColor: z.string(),
  deletedAt: z.string(),
  purgeAt: z.string(),
});
export type DeletedTrip = z.infer<typeof DeletedTrip>;

/** GET /trips: my trips, and the ones I deleted as an owner that can still come back. */
export const MyTrips = z.object({
  trips: z.array(TripSummary),
  deleted: z.array(DeletedTrip).default([]),
});
export type MyTrips = z.infer<typeof MyTrips>;

/**
 * Splits my trips the way the home screen shows them. Past means it ended
 * before `today` (YYYY-MM-DD, the phone's own date); archived trips go to
 * the bottom whatever their dates.
 */
export const groupTrips = <T extends Pick<TripSummary, 'startDate' | 'endDate' | 'archived'>>(
  trips: T[],
  today: string,
) => {
  const upcoming: T[] = [];
  const past: T[] = [];
  const archived: T[] = [];
  for (const trip of trips) {
    const last = trip.endDate ?? trip.startDate;
    if (trip.archived) archived.push(trip);
    else if (last && last < today) past.push(trip);
    else upcoming.push(trip);
  }
  // The trip that just ended first.
  past.sort((a, b) => ((b.endDate ?? b.startDate)! < (a.endDate ?? a.startDate)! ? -1 : 1));
  return { upcoming, past, archived };
};

/**
 * Sets the cover photo: one of the trip's photos (uploaded as a cover, or
 * picked from the album), or the destination's photo from Wikipedia.
 */
export const SetCoverInput = z.union([
  z.object({ photoId: z.string().uuid() }),
  z.object({
    wikipediaUrl: z
      .string()
      .url()
      .refine((u) => /^https:\/\/upload\.wikimedia\.org\//.test(u), 'Only photos from Wikipedia can be used'),
    credit: z.string().trim().max(300).nullable().optional(),
  }),
]);
export type SetCoverInput = z.input<typeof SetCoverInput>;

/** The destination's photo on Wikipedia, offered as a cover. */
export const CoverSuggestion = z.object({
  url: z.string().url(),
  credit: z.string().nullable(),
  /** The article it came from, for the credit's link. */
  pageUrl: z.string().url().nullable(),
});
export type CoverSuggestion = z.infer<typeof CoverSuggestion>;

/** Unread counts for one trip's tabs. */
export const TripUnread = z.object({ chat: z.number().int() });
export type TripUnread = z.infer<typeof TripUnread>;

export const Trip = TripSummary.omit({ unreadCount: true }).extend({
  /** The signed-in user's id, so screens can tell which member is "you". */
  myUserId: z.string().uuid(),
  baseCurrency: z.string().length(3),
  /** Where it is, when a real place was picked; maps, weather and Explore need it. */
  location: TripLocation.nullable(),
  /** The destination's time zone, e.g. "Asia/Kolkata", once known. */
  timezone: z.string().nullable(),
  /**
   * Every place on the trip, in order; at least one. `destination`,
   * `location` and `timezone` above summarise them for older phones.
   */
  places: z.array(TripPlace).default([]),
  members: z.array(TripMember),
  /** Which photo is on the cover, so Edit can show it and offer "Remove photo". */
  coverPhotoId: z.string().uuid().nullable().default(null),
  version: z.number().int(),
});
export type Trip = z.infer<typeof Trip>;
