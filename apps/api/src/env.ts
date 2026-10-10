import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  GATEWAY_PORT: z.coerce.number().int().default(3002),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  S3_ENDPOINT: z.string().url().default('http://localhost:8333'),
  /** Where phones reach storage, if not the same address (see lib/storage.ts). */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('tagalong'),
  S3_ACCESS_KEY: z.string().default('tagalong'),
  S3_SECRET_KEY: z.string().default('tagalong-secret'),
  /** How long an upload or download link stays valid. */
  S3_URL_TTL_SEC: z.coerce.number().int().default(10 * 60),
  /** Daily exchange rates (see lib/fx.ts). */
  FX_API_URL: z.string().url().default('https://api.frankfurter.dev/v1'),
  /** Sends sign-in codes, e.g. smtps://user:app-password@smtp.gmail.com:465. Logged instead when unset. */
  SMTP_URL: z.string().url().optional(),
  MAIL_FROM: z.string().default('Tagalong <no-reply@tagalong.app>'),
  /** Websites allowed to call the API from a browser, comma-separated. Unset allows any (development). */
  CORS_ORIGINS: z.string().optional(),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
}).superRefine((env, ctx) => {
  // Development defaults are fine on a laptop and dangerous on the internet.
  if (env.NODE_ENV !== 'production') return;
  const problem = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (!env.SMTP_URL) problem('SMTP_URL', 'required in production, or nobody can get a sign-in code');
  if (env.JWT_SECRET.length < 32 || env.JWT_SECRET.startsWith('change-me')) {
    problem('JWT_SECRET', 'use at least 32 random characters in production (openssl rand -hex 32)');
  }
  if (env.S3_SECRET_KEY === 'tagalong-secret') problem('S3_SECRET_KEY', 'change the development storage key');
  if (!env.CORS_ORIGINS) problem('CORS_ORIGINS', 'list the web app address in production');
});

export type Env = z.infer<typeof EnvSchema>;

export const loadEnv = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment. Copy .env.example to .env.\n${problems.join('\n')}`);
  }
  return parsed.data;
};
