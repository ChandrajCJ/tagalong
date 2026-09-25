import { runMigrations } from './migrate-fn';

const useTest = process.argv.includes('--test');
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

if (!url) {
  console.error(`Missing ${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'}. Copy .env.example to .env.`);
  process.exit(1);
}

await runMigrations(url);
console.log(`Migrations applied to ${new URL(url).pathname.slice(1)}`);
