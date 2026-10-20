import { z } from 'zod';

export const RequestCodeInput = z.object({
  email: z.string().trim().toLowerCase().email(),
});
export type RequestCodeInput = z.infer<typeof RequestCodeInput>;

export const VerifyCodeInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  deviceName: z.string().max(100).optional(),
});
export type VerifyCodeInput = z.infer<typeof VerifyCodeInput>;

export const RefreshInput = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshInput = z.infer<typeof RefreshInput>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

export const Me = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  homeCurrency: z.string().length(3),
  upiId: z.string().nullable(),
  /** Others see when you've read their messages (and you see theirs). */
  readReceipts: z.boolean().default(true),
  /** A short-lived link to your profile photo, and what changes when the photo does. */
  avatarUrl: z.string().url().nullable().default(null),
  avatarVersion: z.string().nullable().default(null),
});
export type Me = z.infer<typeof Me>;

/** Profile photos: square, made small on the phone, and at most this big. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** POST /me/avatar: asks where to upload a new profile photo. */
export const AvatarUploadInput = z.object({
  contentType: z.enum(AVATAR_CONTENT_TYPES, { message: 'Use a JPEG, PNG or WebP photo' }),
  size: z.number().int().positive().max(AVATAR_MAX_BYTES, 'That photo is too big (2 MB at most)'),
});
export type AvatarUploadInput = z.input<typeof AvatarUploadInput>;

export const AvatarUpload = z.object({ key: z.string(), uploadUrl: z.string().url() });
export type AvatarUpload = z.infer<typeof AvatarUpload>;

/** PUT /me/avatar: the uploaded photo becomes your profile photo. */
export const SetAvatarInput = z.object({ key: z.string().min(1).max(200) });

/** "avatars/<user>/<random>.jpg" → "<random>": changes whenever the photo does, so caches refresh. */
export const avatarVersionOf = (key: string | null) => key?.split('/').pop()?.split('.')[0] ?? null;

/** A UPI ID (VPA) looks like name@bank: letters, digits, dots, hyphens and underscores, then a handle. */
export const UPI_ID = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$/, 'Use a UPI ID like name@okaxis');

export const UpdateMeInput = z
  .object({
    displayName: z.string().trim().min(1, 'Enter your name').max(60).optional(),
    upiId: UPI_ID.nullable().optional(),
    readReceipts: z.boolean().optional(),
  })
  .refine((v) => v.displayName !== undefined || v.upiId !== undefined || v.readReceipts !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateMeInput = z.input<typeof UpdateMeInput>;
