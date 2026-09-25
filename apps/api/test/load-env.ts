import { fileURLToPath } from 'node:url';

/** Loads the repo's .env (if present) and points the app at the test database. */
export const loadTestEnv = () => {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
  } catch {
    // No .env file: CI provides the variables directly.
  }
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('Set TEST_DATABASE_URL to run the API tests');
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ??= 'test-secret-that-is-long-enough';
  return testUrl;
};
