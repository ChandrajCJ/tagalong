import { documents, photos, trips } from '@tagalong/db';
import type { DocumentUpload, MessagePage, MyTrips, PhotoUpload, Trip, TripEvent } from '@tagalong/shared';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgeDeletedTrips } from '../src/jobs/purge';
import { processThumbnail } from '../src/jobs/thumbnail';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('archiving and deleting trips', () => {
  const t = useTestApp();

  let listener: Redis;
  const events: TripEvent[] = [];
  beforeAll(async () => {
    listener = new Redis(process.env.REDIS_URL!);
    await listener.psubscribe('trip:*');
    listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
  });
  afterAll(() => listener.disconnect());
  const heard = async (type: TripEvent['type']) => {
    await new Promise((r) => setTimeout(r, 100));
    return events.filter((e) => e.type === type);
  };

  const myTrips = async (token: string) =>
    (await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(token) })).json<MyTrips>();

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    return { owner, sam, tripId };
  };

  /** Moves the trip's deletion back in time, as if days had passed. */
  const deletedDaysAgo = (tripId: string, days: number) =>
    t.db
      .update(trips)
      .set({ deletedAt: new Date(Date.now() - days * DAY_MS) })
      .where(eq(trips.id, tripId));

  describe('archive', () => {
    it('hides the trip from my list only', async () => {
      const { owner, sam, tripId } = await setup();
      const res = await t.app.inject({ method: 'POST', url: `/trips/${tripId}/archive`, headers: bearer(sam.accessToken) });
      expect(res.statusCode).toBe(204);

      expect((await myTrips(sam.accessToken)).trips.find((x) => x.id === tripId)?.archived).toBe(true);
      expect((await myTrips(owner.accessToken)).trips.find((x) => x.id === tripId)?.archived).toBe(false);
      // Archived, not gone: Sam can still open it.
      const trip = await t.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(sam.accessToken) });
      expect(trip.json<Trip>().archived).toBe(true);

      await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}/archive`, headers: bearer(sam.accessToken) });
      expect((await myTrips(sam.accessToken)).trips.find((x) => x.id === tripId)?.archived).toBe(false);
    });

    it('needs you to be on the trip', async () => {
      const { tripId } = await setup();
      const stranger = await t.signIn('stranger@example.com');
      const res = await t.app.inject({ method: 'POST', url: `/trips/${tripId}/archive`, headers: bearer(stranger.accessToken) });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('delete', () => {
    it('is for owners only', async () => {
      const { sam, tripId } = await setup();
      const res = await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}`, headers: bearer(sam.accessToken) });
      expect(res.statusCode).toBe(403);
    });

    it('removes the trip for everyone at once, and says so', async () => {
      const { owner, sam, tripId } = await setup();
      events.length = 0;
      const res = await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) });
      expect(res.statusCode).toBe(204);
      expect((await heard('trip.deleted')).map((e) => e.tripId)).toEqual([tripId]);

      for (const token of [owner.accessToken, sam.accessToken]) {
        expect((await myTrips(token)).trips).toEqual([]);
        for (const url of [`/trips/${tripId}`, `/trips/${tripId}/messages`, `/trips/${tripId}/items`, `/trips/${tripId}/unread`]) {
          expect((await t.app.inject({ method: 'GET', url, headers: bearer(token) })).statusCode).toBe(404);
        }
      }
      // Only the owner sees it under "Recently deleted".
      const deleted = (await myTrips(owner.accessToken)).deleted;
      expect(deleted.map((d) => d.id)).toEqual([tripId]);
      expect(new Date(deleted[0]!.purgeAt).getTime() - new Date(deleted[0]!.deletedAt).getTime()).toBe(30 * DAY_MS);
      expect((await myTrips(sam.accessToken)).deleted).toEqual([]);
    });

    it('can be restored by the owner within 30 days, with a card in the chat', async () => {
      const { owner, sam, tripId } = await setup();
      await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) });

      expect((await t.app.inject({ method: 'POST', url: `/trips/${tripId}/restore`, headers: bearer(sam.accessToken) })).statusCode).toBe(404);

      await deletedDaysAgo(tripId, 29);
      const res = await t.app.inject({ method: 'POST', url: `/trips/${tripId}/restore`, headers: bearer(owner.accessToken) });
      expect(res.statusCode).toBe(200);
      expect(res.json<Trip>().id).toBe(tripId);
      expect((await myTrips(sam.accessToken)).trips.map((x) => x.id)).toEqual([tripId]);
      expect((await myTrips(owner.accessToken)).deleted).toEqual([]);

      const chat = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(sam.accessToken) });
      expect(chat.json<MessagePage>().messages.slice(0, 2).map((m) => m.body)).toEqual([
        'owner restored the trip',
        'owner deleted the trip',
      ]);
    });

    it('can’t be restored after 30 days', async () => {
      const { owner, tripId } = await setup();
      await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) });
      await deletedDaysAgo(tripId, 31);
      expect((await t.app.inject({ method: 'POST', url: `/trips/${tripId}/restore`, headers: bearer(owner.accessToken) })).statusCode).toBe(404);
      expect((await myTrips(owner.accessToken)).deleted).toEqual([]);
    });
  });

  describe('purge', () => {
    const uploadDocument = async (tripId: string, token: string) => {
      const started = await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/documents`,
        headers: bearer(token),
        payload: { name: 'Flight.pdf', contentType: 'application/pdf', sizeBytes: 120_000, kind: 'flight' },
      });
      const { document, uploadUrl } = started.json<DocumentUpload>();
      t.putObject(uploadUrl, 120_000);
      await t.app.inject({ method: 'POST', url: `/documents/${document.id}/complete`, headers: bearer(token) });
    };

    const uploadPhoto = async (tripId: string, token: string) => {
      const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#0E6B5C' } }).jpeg().toBuffer();
      const started = await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/photos`,
        headers: bearer(token),
        payload: { batchId: crypto.randomUUID(), contentType: 'image/jpeg', sizeBytes: bytes.length, width: 600, height: 400 },
      });
      const { photo, uploadUrl } = started.json<PhotoUpload>();
      t.putObject(uploadUrl, 0, bytes);
      await t.app.inject({ method: 'POST', url: `/photos/${photo.id}/complete`, headers: bearer(token) });
      await processThumbnail({ db: t.db, redis: t.redis, storage: t.storage }, { photoId: photo.id });
    };

    const storedKeys = async (tripId: string) => {
      const p = await t.db.select().from(photos).where(eq(photos.tripId, tripId));
      const d = await t.db.select().from(documents).where(eq(documents.tripId, tripId));
      return [...p.flatMap((r) => [r.storageKey, r.thumbKey]), ...d.map((r) => r.storageKey)].filter((k): k is string => !!k);
    };

    it('removes trips deleted over 30 days ago, with their rows and files', async () => {
      const { owner, tripId } = await setup();
      await uploadPhoto(tripId, owner.accessToken);
      await uploadDocument(tripId, owner.accessToken);
      await t.app.inject({ method: 'POST', url: `/trips/${tripId}/messages`, headers: bearer(owner.accessToken), payload: { body: 'hi' } });
      const keys = await storedKeys(tripId);
      expect(keys).toHaveLength(3);
      for (const key of keys) expect(await t.storage.sizeOf(key)).not.toBeNull();

      // A trip still in its restore window, and one never deleted, stay.
      const recent = await createTrip(t.app, owner.accessToken, 'Porto');
      const kept = await createTrip(t.app, owner.accessToken, 'Madeira');
      await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) });
      await t.app.inject({ method: 'DELETE', url: `/trips/${recent}`, headers: bearer(owner.accessToken) });
      await deletedDaysAgo(tripId, 31);
      await deletedDaysAgo(recent, 10);

      expect(await purgeDeletedTrips({ db: t.db, storage: t.storage })).toEqual({ trips: 1, files: 3 });

      for (const key of keys) expect(await t.storage.sizeOf(key)).toBeNull();
      const left = await t.db.select({ id: trips.id }).from(trips);
      expect(left.map((r) => r.id).sort()).toEqual([recent, kept].sort());
      const [orphans] = await t.db.execute<{ n: number }>(
        sql`select (select count(*) from chat.messages where trip_id = ${tripId})::int
              + (select count(*) from trips.trip_members where trip_id = ${tripId})::int
              + (select count(*) from sync.change_log where trip_id = ${tripId})::int as n`,
      );
      expect(orphans?.n).toBe(0);
    });
  });
});
