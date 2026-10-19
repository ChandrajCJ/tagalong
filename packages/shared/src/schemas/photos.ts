import { z } from 'zod';

/**
 * What the album stores. Every phone and browser can show these; iPhones'
 * HEIC is converted to JPEG on the phone before upload, because the server's
 * image library can't read it.
 */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Videos as phones and browsers record them. */
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const MEDIA_CONTENT_TYPES = [...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as const;

/** A minute and 50 MB at most per video: the free storage's per-file cap, so 1 GB lasts. */
export const MAX_VIDEO_MS = 60_000;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** The phone resizes before upload, so real photos are far smaller than this. */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** How many photos one pick can add. */
export const MAX_PHOTOS_PER_BATCH = 100;

/** "2026-06-12T18:30:00": the clock where the photo was taken, with no timezone. */
export const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, 'Use a local date and time like 2026-06-12T18:30:00');

/** Where a photo was added: the album, a chat message, or the trip's cover. */
export const PHOTO_SOURCES = ['album', 'chat', 'cover'] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

export const Photo = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  uploadedBy: z.string().uuid(),
  uploaderName: z.string().nullable(),
  batchId: z.string().uuid(),
  contentType: z.enum(MEDIA_CONTENT_TYPES),
  /** A photo, or a short video (its thumbnail is the poster frame). */
  kind: z.enum(['photo', 'video']).default('photo'),
  durationMs: z.number().int().nullable().default(null),
  sizeBytes: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  takenAt: localDateTime.nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  status: z.enum(['pending', 'ready']),
  caption: z.string().nullable(),
  source: z.enum(PHOTO_SOURCES).default('album'),
  version: z.number().int(),
  createdAt: z.string(),
  /** How many people hearted it, and whether this person did. */
  favourites: z.number().int(),
  favourited: z.boolean(),
  /** Short-lived signed links. Null until the thumbnail exists. */
  thumbUrl: z.string().url().nullable(),
  url: z.string().url().nullable(),
});
export type Photo = z.infer<typeof Photo>;

export const PhotoList = z.object({
  photos: z.array(Photo),
  /** Seconds the signed links stay valid; fetch again after that. */
  expiresIn: z.number().int(),
});
export type PhotoList = z.infer<typeof PhotoList>;

export const CreatePhotoInput = z
  .object({
    id: z.string().uuid().optional(),
    batchId: z.string().uuid(),
    contentType: z.enum(MEDIA_CONTENT_TYPES, {
      errorMap: () => ({ message: 'Photos need to be JPEG, PNG or WebP, and videos MP4, MOV or WebM' }),
    }),
    kind: z.enum(['photo', 'video']).default('photo'),
    /** How long a video is; required for videos. */
    durationMs: z.number().int().positive().nullable().optional(),
    sizeBytes: z.number().int().positive().max(MAX_VIDEO_BYTES, 'That’s too big: videos can be up to 50 MB, photos 25 MB'),
    width: z.number().int().positive().max(20_000).optional(),
    height: z.number().int().positive().max(20_000).optional(),
    takenAt: localDateTime.nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    caption: z.string().trim().max(500).nullable().optional(),
    /** Chat and cover photos stay out of the album. */
    source: z.enum(PHOTO_SOURCES).default('album'),
  })
  .refine((p) => (p.latitude == null) === (p.longitude == null), {
    message: 'A location needs both latitude and longitude',
    path: ['latitude'],
  })
  .refine((p) => (p.kind === 'video') === (VIDEO_CONTENT_TYPES as readonly string[]).includes(p.contentType), {
    message: 'That file type doesn’t match',
    path: ['contentType'],
  })
  .refine((p) => p.kind === 'video' || p.sizeBytes <= MAX_PHOTO_BYTES, {
    message: 'Photos need to be 25 MB or smaller',
    path: ['sizeBytes'],
  })
  .refine((p) => p.kind === 'photo' || (p.durationMs != null && p.durationMs <= MAX_VIDEO_MS), {
    message: 'Videos can be up to a minute long',
    path: ['durationMs'],
  });
export type CreatePhotoInput = z.input<typeof CreatePhotoInput>;

export const PhotoUpload = z.object({
  photo: Photo,
  uploadUrl: z.string().url(),
  /** For a video: where to send its poster frame (a JPEG), which becomes its thumbnail. */
  posterUploadUrl: z.string().url().nullable().default(null),
  expiresIn: z.number().int(),
});
export type PhotoUpload = z.infer<typeof PhotoUpload>;

/** What a heart changes, broadcast so every album updates its count. */
export const PhotoFavourited = z.object({
  photoId: z.string().uuid(),
  userId: z.string().uuid(),
  added: z.boolean(),
  count: z.number().int(),
});
export type PhotoFavourited = z.infer<typeof PhotoFavourited>;

/** The answer to a heart: the new count, and this person's own state. */
export const FavouriteResult = z.object({ favourites: z.number().int(), favourited: z.boolean() });
export type FavouriteResult = z.infer<typeof FavouriteResult>;
