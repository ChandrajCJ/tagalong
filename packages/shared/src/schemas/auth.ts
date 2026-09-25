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
});
export type Me = z.infer<typeof Me>;
