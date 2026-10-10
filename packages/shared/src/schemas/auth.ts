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
});
export type Me = z.infer<typeof Me>;

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
  })
  .refine((v) => v.displayName !== undefined || v.upiId !== undefined, { message: 'Nothing to change' });
export type UpdateMeInput = z.input<typeof UpdateMeInput>;
