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
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(15 * 60),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
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
