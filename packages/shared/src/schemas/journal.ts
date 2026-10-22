import { z } from 'zod';
import { MessageReaction } from './chat';
import { Photo } from './photos';

/** How the day felt, optionally. */
export const JOURNAL_MOODS = ['😍', '🙂', '😴', '🥵', '🌧️', '🤯'] as const;
export type JournalMood = (typeof JOURNAL_MOODS)[number];

/** "The group" (everyone on the trip) or "Just me" (only the author, ever). */
export const JOURNAL_VISIBILITIES = ['group', 'private'] as const;
export type JournalVisibility = (typeof JOURNAL_VISIBILITIES)[number];

/** A note someone wrote, or a line saved from the chat. */
export const JOURNAL_KINDS = ['note', 'quote'] as const;
export type JournalKind = (typeof JOURNAL_KINDS)[number];

export const MAX_JOURNAL_TEXT = 10_000;
export const MAX_JOURNAL_MEDIA = 12;
export const MAX_JOURNAL_COMMENT = 500;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Where an entry happened: a place picked from the search, or just a name. */
export const JournalPlace = z.object({
  label: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  placeRef: z.string().max(200).nullable(),
});
export type JournalPlace = z.infer<typeof JournalPlace>;

export const JournalComment = z.object({
  id: z.string().uuid(),
  entryId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type JournalComment = z.infer<typeof JournalComment>;

/** What a quote was saved from: who said it in the chat, and when. */
export const JournalQuote = z.object({
  messageId: z.string().uuid().nullable(),
  senderId: z.string().uuid().nullable(),
  senderName: z.string().nullable(),
  sentAt: z.string().nullable(),
});
export type JournalQuote = z.infer<typeof JournalQuote>;

export const JournalEntry = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  authorId: z.string().uuid(),
  authorName: z.string(),
  date: isoDate,
  kind: z.enum(JOURNAL_KINDS),
  body: z.string(),
  mood: z.enum(JOURNAL_MOODS).nullable(),
  visibility: z.enum(JOURNAL_VISIBILITIES),
  /** The photos and videos as picked; `media` has the ones still there, with fresh links. */
  mediaIds: z.array(z.string().uuid()),
  media: z.array(Photo),
  place: JournalPlace.nullable(),
  quote: JournalQuote.nullable(),
  reactions: z.array(MessageReaction),
  comments: z.array(JournalComment),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

const entryFields = {
  date: isoDate,
  body: z.string().trim().min(1, 'Write something first').max(MAX_JOURNAL_TEXT, 'That’s too long for one entry'),
  mood: z.enum(JOURNAL_MOODS).nullable(),
  visibility: z.enum(JOURNAL_VISIBILITIES),
  mediaIds: z.array(z.string().uuid()).max(MAX_JOURNAL_MEDIA, `Up to ${MAX_JOURNAL_MEDIA} photos per entry`),
  place: JournalPlace.nullable(),
};

/** POST /trips/:id/journal. The phone makes the id, so sending twice adds one entry. */
export const CreateJournalEntryInput = z.object({
  id: z.string().uuid().optional(),
  ...entryFields,
  mood: entryFields.mood.default(null),
  visibility: entryFields.visibility.default('group'),
  mediaIds: entryFields.mediaIds.default([]),
  place: entryFields.place.default(null),
});
export type CreateJournalEntryInput = z.input<typeof CreateJournalEntryInput>;

/** PATCH /journal/:id. `version` is the one you last saw. */
export const UpdateJournalEntryInput = z
  .object(entryFields)
  .partial()
  .extend({ version: z.number().int().min(1) });
export type UpdateJournalEntryInput = z.input<typeof UpdateJournalEntryInput>;

export const AddJournalCommentInput = z.object({
  id: z.string().uuid().optional(),
  body: z.string().trim().min(1, 'Write something first').max(MAX_JOURNAL_COMMENT),
});
export type AddJournalCommentInput = z.input<typeof AddJournalCommentInput>;

/** POST /messages/:id/save-to-journal. */
export const SaveToJournalInput = z.object({
  visibility: z.enum(JOURNAL_VISIBILITIES).default('group'),
});
export type SaveToJournalInput = z.input<typeof SaveToJournalInput>;

/** A plan stop on the day header, in plan order. */
export const DayStop = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: z.string(),
  startTime: z.string().nullable(),
  placeName: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type DayStop = z.infer<typeof DayStop>;

/**
 * What a day page shows above the entries, with no typing: where you were,
 * what you did, the day in numbers and its highlights. Counts only what the
 * viewer may see.
 */
export const DayHeader = z.object({
  date: isoDate,
  /** 1 for the trip's first day; null for a day outside the trip's dates. */
  dayNumber: z.number().int().nullable(),
  /** "Porto", or "Lisbon → Porto" on a travel day. */
  city: z.string().nullable(),
  /** Where to ask about the weather (the phone asks Open-Meteo itself). */
  centre: z.object({ latitude: z.number(), longitude: z.number() }).nullable(),
  stops: z.array(DayStop),
  /** Straight lines between the located stops, a floor for the route's real distance. */
  distanceM: z.number().nullable(),
  photoCount: z.number().int(),
  videoCount: z.number().int(),
  messageCount: z.number().int(),
  spentMinor: z.number().int(),
  spentPerPersonMinor: z.number().int(),
  currency: z.string().length(3),
  /** The most favourited photos, else the first few. */
  topPhotos: z.array(Photo),
  /** The most-voted idea that happened that day. */
  topIdea: z.object({ id: z.string().uuid(), title: z.string(), votes: z.number().int() }).nullable(),
  /** The 10 minutes with the most chat messages. */
  busiest: z.object({ from: z.string(), count: z.number().int(), messageId: z.string().uuid() }).nullable(),
});
export type DayHeader = z.infer<typeof DayHeader>;

/** GET /trips/:id/journal/:date: one day page. */
export const JournalDay = z.object({
  header: DayHeader,
  /** Oldest first, so the day reads in order. */
  entries: z.array(JournalEntry),
  /** Who has added something visible to the group that day. */
  writers: z.array(z.string().uuid()),
});
export type JournalDay = z.infer<typeof JournalDay>;

export const JournalDaySummary = z.object({
  date: isoDate,
  dayNumber: z.number().int().nullable(),
  city: z.string().nullable(),
  entryCount: z.number().int(),
  writers: z.array(z.string().uuid()),
});
export type JournalDaySummary = z.infer<typeof JournalDaySummary>;

/** GET /trips/:id/journal: the trip's days, and any other day with entries. */
export const JournalDays = z.object({ days: z.array(JournalDaySummary) });
export type JournalDays = z.infer<typeof JournalDays>;

/** The `journal.updated` event: which day changed, so open pages fetch it again. */
export const JournalUpdated = z.object({ date: isoDate, entryId: z.string().uuid() });
export type JournalUpdated = z.infer<typeof JournalUpdated>;

/** The numbers of a finished trip, worked out by `tripRecap`. Photos are ids, signed when served. */
export const RecapStats = z.object({
  days: z.number().int(),
  places: z.number().int(),
  distanceM: z.number(),
  photos: z.number().int(),
  videos: z.number().int(),
  messages: z.number().int(),
  topEmoji: z.string().nullable(),
  topPhotoIds: z.array(z.string().uuid()),
  /** Each person's share of the spending, most first. */
  spend: z.array(z.object({ userId: z.string().uuid(), shareMinor: z.number().int() })),
  biggestExpense: z.object({ description: z.string(), amountMinor: z.number().int() }).nullable(),
});
export type RecapStats = z.infer<typeof RecapStats>;

export const RecapDay = z.object({
  date: isoDate,
  dayNumber: z.number().int(),
  city: z.string().nullable(),
  /** The day's located stops in order, for the map. */
  route: z.array(z.object({ latitude: z.number(), longitude: z.number(), title: z.string() })),
  topPhotoIds: z.array(z.string().uuid()),
  /** A few lines from the group's entries (never private ones). */
  snippets: z.array(z.object({ authorId: z.string().uuid(), body: z.string(), mood: z.enum(JOURNAL_MOODS).nullable() })),
});
export type RecapDay = z.infer<typeof RecapDay>;

/** What `tripRecap` returns and the server caches. */
export const RecapData = z.object({
  stats: RecapStats,
  days: z.array(RecapDay),
  groupPhotoIds: z.array(z.string().uuid()),
});
export type RecapData = z.infer<typeof RecapData>;

/** GET /trips/:id/recap: the story of the trip, with photos signed for this viewer. */
export const TripRecap = RecapData.extend({
  tripId: z.string().uuid(),
  name: z.string(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  coverColor: z.string(),
  coverUrl: z.string().url().nullable(),
  currency: z.string().length(3),
  members: z.array(z.object({ userId: z.string().uuid(), displayName: z.string() })),
  /** Every photo the recap mentions, by id. */
  photos: z.array(Photo),
  /** The trip is over, so this is the final recap. */
  final: z.boolean(),
});
export type TripRecap = z.infer<typeof TripRecap>;

/** "1 year ago: Goa with the gang", on the trips list. */
export const Memory = z.object({
  tripId: z.string().uuid(),
  tripName: z.string(),
  /** The trip day that matches today, in an earlier year. */
  date: isoDate,
  yearsAgo: z.number().int().min(1),
  coverColor: z.string(),
  coverUrl: z.string().url().nullable(),
});
export type Memory = z.infer<typeof Memory>;

export const MemoryList = z.object({ memories: z.array(Memory) });
export type MemoryList = z.infer<typeof MemoryList>;
