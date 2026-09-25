import { runMigrations } from '@tagalong/db';
import { loadTestEnv } from './load-env';

export default async function setup() {
  await runMigrations(loadTestEnv());
}
