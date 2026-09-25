import { sql as dsql } from 'drizzle-orm';
import { createDb } from './client';
import { changeLog, tripMembers, trips, users } from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Missing DATABASE_URL. Copy .env.example to .env.');
  process.exit(1);
}

const { db, close } = createDb(url, { max: 1 });

const people = [
  { email: 'demo@tagalong.app', displayName: 'Demo traveler' },
  { email: 'sam@tagalong.app', displayName: 'Sam' },
  { email: 'priya@tagalong.app', displayName: 'Priya' },
  { email: 'alex@tagalong.app', displayName: 'Alex' },
];

const existing = await db
  .select({ id: users.id })
  .from(users)
  .where(dsql`lower(${users.email}) = 'demo@tagalong.app'`);

if (existing.length > 0) {
  console.log('Seed data already present, nothing to do.');
} else {
  await db.transaction(async (tx) => {
    const created = await tx.insert(users).values(people).returning({ id: users.id });
    const [demo, ...friends] = created;
    if (!demo) throw new Error('Seed failed to create users');

    const [trip] = await tx
      .insert(trips)
      .values({
        name: 'Lisbon with the crew',
        destination: 'Lisbon, Portugal',
        startDate: '2027-06-12',
        endDate: '2027-06-16',
        baseCurrency: 'EUR',
        coverColor: '#D8A47F',
        createdBy: demo.id,
      })
      .returning({ id: trips.id });
    if (!trip) throw new Error('Seed failed to create trip');

    await tx.insert(tripMembers).values([
      { tripId: trip.id, userId: demo.id, role: 'owner' },
      ...friends.map((f) => ({ tripId: trip.id, userId: f.id, role: 'editor' })),
    ]);
    await tx
      .insert(changeLog)
      .values({ tripId: trip.id, entity: 'trip', entityId: trip.id, op: 'upsert', changedBy: demo.id });
  });
  console.log('Seeded demo@tagalong.app with the "Lisbon with the crew" trip.');
}

await close();
