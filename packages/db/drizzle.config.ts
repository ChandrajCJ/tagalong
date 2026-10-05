import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['identity', 'trips', 'sync', 'itinerary', 'chat'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://tagalong:tagalong@localhost:5432/tagalong',
  },
});
