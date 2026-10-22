import { journalRecaps } from '@tagalong/db';
import type { ChatMessage, JournalDay, JournalDays, JournalEntry, MemoryList, Photo, PhotoUpload, Trip, TripEvent, TripRecap } from '@tagalong/shared';
import { tripChannel } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { queueJournalPrompts, queueMemories, queueRecaps } from '../src/jobs/journal';
import type { PushMessage, PushSender } from '../src/jobs/notify';
import { bearer, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(token), payload });

const GOA = { placeId: 'osm:R:1', latitude: 15.3, longitude: 74.1, bounds: null, countryCode: 'IN' };

/** Alex owns a Goa trip (on India time); Sam is an editor and Priya a viewer. */
const setup = async (dates = { startDate: '2026-11-01', endDate: '2026-11-05' }) => {
  const owner = await ctx.signIn('alex@example.com');
  await call('POST', '/me/devices/push-token', owner.accessToken, { token: 'ExponentPushToken[alex]', platform: 'android', timezone: 'Asia/Kolkata' });
  const trip = (await call('POST', '/trips', owner.accessToken, { name: 'Goa', destination: 'Goa, India', location: GOA, ...dates })).json<Trip>();
  const alex = { ...owner, userId: trip.myUserId };
  const sam = await joinTrip(ctx, trip.id, owner.accessToken, 'sam@example.com', 'editor');
  const priya = await joinTrip(ctx, trip.id, owner.accessToken, 'priya@example.com', 'viewer');
  return { tripId: trip.id, alex, sam, priya };
};

const write = (tripId: string, token: string, body: Record<string, unknown>) =>
  call('POST', `/trips/${tripId}/journal`, token, { date: '2026-11-02', body: 'Sunset at Anjuna', ...body });

const dayOf = async (tripId: string, token: string, date = '2026-11-02') => {
  const res = await call('GET', `/trips/${tripId}/journal/${date}`, token);
  expect(res.statusCode).toBe(200);
  return res.json<JournalDay>();
};

const recorder = () => {
  const sent: PushMessage[] = [];
  const push: PushSender = {
    async send(batch) {
      sent.push(...batch);
      return batch.map(() => ({ status: 'ok' as const }));
    },
  };
  return { push, sent };
};

/** Uploads a photo taken at `takenAt` and returns it, ready. */
const upload = async (tripId: string, token: string, takenAt: string, source = 'album') => {
  const started = await call('POST', `/trips/${tripId}/photos`, token, {
    batchId: crypto.randomUUID(),
    contentType: 'image/jpeg',
    sizeBytes: 1000,
    takenAt,
    source,
  });
  expect(started.statusCode).toBe(201);
  const { photo, uploadUrl } = started.json<PhotoUpload>();
  ctx.putObject(uploadUrl, 1000);
  return (await call('POST', `/photos/${photo.id}/complete`, token)).json<Photo>();
};

describe('journal entries', () => {
  it('lets anyone on the trip write, viewers too, and sending twice adds one', async () => {
    const { tripId, priya } = await setup();
    const id = '01900000-0000-7000-8000-00000000a001';
    const first = await write(tripId, priya.accessToken, { id, mood: '😍', place: { label: 'Anjuna Beach', latitude: 15.58, longitude: 73.74, placeRef: null } });
    expect(first.statusCode).toBe(201);
    expect(first.json<JournalEntry>()).toMatchObject({ authorId: priya.userId, mood: '😍', visibility: 'group', place: { label: 'Anjuna Beach' } });
    expect((await write(tripId, priya.accessToken, { id })).statusCode).toBe(200);
    expect((await dayOf(tripId, priya.accessToken)).entries).toHaveLength(1);
  });

  it('keeps private entries to their author, everywhere', async () => {
    const { tripId, alex, sam } = await setup();
    await write(tripId, sam.accessToken, { body: 'Homesick tonight', visibility: 'private' });
    await write(tripId, alex.accessToken, { body: 'Best day yet' });

    const mine = await dayOf(tripId, sam.accessToken);
    expect(mine.entries.map((e) => e.body)).toEqual(['Homesick tonight', 'Best day yet']);
    expect(mine.writers.sort()).toEqual([alex.userId, sam.userId].sort());

    // Alex, the owner, sees only his own; Sam doesn't count as having written.
    const theirs = await dayOf(tripId, alex.accessToken);
    expect(theirs.entries.map((e) => e.body)).toEqual(['Best day yet']);
    expect(theirs.writers).toEqual([alex.userId]);
    const list = (await call('GET', `/trips/${tripId}/journal`, alex.accessToken)).json<JournalDays>();
    expect(list.days.find((d) => d.date === '2026-11-02')).toMatchObject({ entryCount: 1, writers: [alex.userId] });
    expect(list.days.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5]);

    // Not even the owner can touch it: to him it doesn't exist.
    const secret = mine.entries[0]!;
    expect((await call('DELETE', `/journal/${secret.id}`, alex.accessToken)).statusCode).toBe(404);
    expect((await call('POST', `/journal/${secret.id}/comments`, alex.accessToken, { body: 'hi' })).statusCode).toBe(404);
  });

  it('lets only the author edit, and the author or an owner delete', async () => {
    const { tripId, alex, sam, priya } = await setup();
    const entry = (await write(tripId, sam.accessToken, {})).json<JournalEntry>();
    expect((await call('PATCH', `/journal/${entry.id}`, priya.accessToken, { body: 'mine now', version: 1 })).statusCode).toBe(403);
    expect((await call('DELETE', `/journal/${entry.id}`, priya.accessToken)).statusCode).toBe(403);

    const edited = await call('PATCH', `/journal/${entry.id}`, sam.accessToken, { body: 'Sunset at Anjuna, with chai', version: 1 });
    expect(edited.json<JournalEntry>()).toMatchObject({ body: 'Sunset at Anjuna, with chai', version: 2 });
    const stale = await call('PATCH', `/journal/${entry.id}`, sam.accessToken, { mood: '🥵', version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toMatchObject({ version: 2 });

    // The owner can remove it, for moderation, like chat.
    expect((await call('DELETE', `/journal/${entry.id}`, alex.accessToken)).statusCode).toBe(204);
    expect((await dayOf(tripId, sam.accessToken)).entries).toEqual([]);
  });

  it('takes photos from this trip only, and journal photos join the album', async () => {
    const { tripId, alex, sam } = await setup();
    const fresh = await upload(tripId, sam.accessToken, '2026-11-02T18:30:00', 'journal');
    const entry = (await write(tripId, sam.accessToken, { mediaIds: [fresh.id] })).json<JournalEntry>();
    expect(entry.media.map((p) => p.id)).toEqual([fresh.id]);
    const album = (await call('GET', `/trips/${tripId}/photos`, alex.accessToken)).json<{ photos: Photo[] }>();
    expect(album.photos.map((p) => p.id)).toEqual([fresh.id]);

    const other = (await call('POST', '/trips', alex.accessToken, { name: 'Porto', destination: 'Porto' })).json<Trip>();
    const elsewhere = await upload(other.id, alex.accessToken, '2026-11-02T10:00:00');
    expect((await write(tripId, alex.accessToken, { mediaIds: [elsewhere.id] })).statusCode).toBe(400);
  });
});

describe('reactions, comments and live updates', () => {
  it('reacts and comments on group entries only', async () => {
    const { tripId, alex, priya } = await setup();
    const shared = (await write(tripId, alex.accessToken, {})).json<JournalEntry>();
    const secret = (await write(tripId, priya.accessToken, { visibility: 'private' })).json<JournalEntry>();

    const reacted = await call('POST', `/journal/${shared.id}/reactions`, priya.accessToken, { emoji: '😂' });
    expect(reacted.json<JournalEntry>().reactions).toEqual([{ emoji: '😂', count: 1, mine: true }]);
    const commented = await call('POST', `/journal/${shared.id}/comments`, priya.accessToken, { body: 'So jealous' });
    expect(commented.statusCode).toBe(201);
    const comment = commented.json<JournalEntry>().comments[0]!;
    expect(comment).toMatchObject({ body: 'So jealous', authorId: priya.userId });

    expect((await call('POST', `/journal/${secret.id}/reactions`, priya.accessToken, { emoji: '😂' })).statusCode).toBe(400);
    expect((await call('POST', `/journal/${secret.id}/comments`, priya.accessToken, { body: 'note to self' })).statusCode).toBe(400);

    // The owner can remove a comment; nobody else but its author.
    const sam = await joinTrip(ctx, tripId, alex.accessToken, 'sam@example.com');
    expect((await call('DELETE', `/journal-comments/${comment.id}`, sam.accessToken)).statusCode).toBe(403);
    expect((await call('DELETE', `/journal-comments/${comment.id}`, alex.accessToken)).statusCode).toBe(204);
    expect((await dayOf(tripId, alex.accessToken)).entries[0]!.comments).toEqual([]);
  });

  it('tells open pages about group changes, and nothing about private ones', async () => {
    const { tripId, alex } = await setup();
    const listener = new Redis(loadEnv().REDIS_URL);
    const heard: TripEvent[] = [];
    await listener.subscribe(tripChannel(tripId));
    listener.on('message', (_c, raw) => heard.push(JSON.parse(raw)));
    const shared = (await write(tripId, alex.accessToken, {})).json<JournalEntry>();
    await write(tripId, alex.accessToken, { visibility: 'private', body: 'just me' });
    await call('POST', `/journal/${shared.id}/reactions`, alex.accessToken, { emoji: '🎉' });
    await new Promise((r) => setTimeout(r, 100));
    listener.disconnect();
    const events = heard.filter((e) => e.type === 'journal.updated');
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.entityId === shared.id)).toBe(true);
    expect(events[0]!.payload).toEqual({ date: '2026-11-02', entryId: shared.id });
  });
});

describe('save to journal', () => {
  it('turns a chat message into a quote on its day, linking back', async () => {
    const { tripId, alex, sam } = await setup();
    const sent = await call('POST', `/trips/${tripId}/messages`, sam.accessToken, { body: 'I am never eating that again' });
    const message = sent.json<ChatMessage>();
    const saved = await call('POST', `/messages/${message.id}/save-to-journal`, alex.accessToken, {});
    expect(saved.statusCode).toBe(201);
    const quote = saved.json<JournalEntry>();
    expect(quote).toMatchObject({
      kind: 'quote',
      body: 'I am never eating that again',
      authorId: alex.userId,
      quote: { messageId: message.id, senderId: sam.userId, senderName: 'sam' },
    });
    // On the day it was said, on the trip's clock.
    expect(quote.date).toBe(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
    expect((await call('POST', `/messages/${message.id}/save-to-journal`, alex.accessToken, {})).json<JournalEntry>().id).toBe(quote.id);
    // What was said stays as it was said.
    expect((await call('PATCH', `/journal/${quote.id}`, alex.accessToken, { body: 'edited', version: 1 })).statusCode).toBe(400);
  });
});

describe('the day header', () => {
  it('fills itself from the plan, photos, chat and money', async () => {
    const { tripId, alex, sam } = await setup();
    const stop = (title: string, latitude: number, longitude: number) =>
      call('POST', `/trips/${tripId}/items`, alex.accessToken, { title, date: '2026-11-02', latitude, longitude });
    await stop('Fort Aguada', 15.49, 73.77);
    await stop('Candolim', 15.52, 73.76);
    await upload(tripId, alex.accessToken, '2026-11-02T09:00:00');
    await upload(tripId, alex.accessToken, '2026-11-03T09:00:00');
    await call('POST', `/trips/${tripId}/expenses`, alex.accessToken, {
      description: 'Lunch',
      currency: 'EUR',
      spentOn: '2026-11-02',
      paidBy: alex.userId,
      amountMinor: 3000,
      splits: [{ userId: alex.userId }, { userId: sam.userId }],
    });

    const { header } = await dayOf(tripId, sam.accessToken);
    expect(header).toMatchObject({
      date: '2026-11-02',
      dayNumber: 2,
      city: 'Goa',
      photoCount: 1,
      spentMinor: 3000,
      // Three people on the trip.
      spentPerPersonMinor: 1000,
    });
    expect(header.stops.map((s) => s.title)).toEqual(['Fort Aguada', 'Candolim']);
    expect(header.distanceM).toBeGreaterThan(3000);
    expect(header.topPhotos).toHaveLength(1);
  });
});

describe('the recap', () => {
  it('is the same for everyone and never shows a private entry; it’s kept once the trip is over', async () => {
    const { tripId, alex, sam } = await setup({ startDate: '2025-11-01', endDate: '2025-11-03' });
    await write(tripId, alex.accessToken, { date: '2025-11-01', body: 'We made it!' });
    await write(tripId, sam.accessToken, { date: '2025-11-01', body: 'secret', visibility: 'private' });
    const recap = (await call('GET', `/trips/${tripId}/recap`, sam.accessToken)).json<TripRecap>();
    expect(recap).toMatchObject({ final: true, name: 'Goa', stats: { days: 3, places: 1 } });
    expect(recap.days[0]!.snippets.map((s) => s.body)).toEqual(['We made it!']);
    expect(recap.members.map((m) => m.displayName)).toEqual(['alex', 'sam', 'priya']);
    const [cached] = await ctx.db.select().from(journalRecaps).where(eq(journalRecaps.tripId, tripId));
    expect(cached).toBeDefined();

    // Something new on the trip: worked out again.
    await write(tripId, sam.accessToken, { date: '2025-11-02', body: 'Day two' });
    const again = (await call('GET', `/trips/${tripId}/recap`, alex.accessToken)).json<TripRecap>();
    expect(again.days[1]!.snippets.map((s) => s.body)).toEqual(['Day two']);
  });

  it('“Plan the next one” brings the same people along', async () => {
    const { tripId, alex, sam, priya } = await setup();
    const next = (
      await call('POST', '/trips', sam.accessToken, { name: 'Goa again', destination: 'Goa', copyMembersFrom: tripId })
    ).json<Trip>();
    const roles = Object.fromEntries(next.members.map((m) => [m.userId, m.role]));
    expect(roles).toEqual({ [sam.userId]: 'owner', [alex.userId]: 'editor', [priya.userId]: 'viewer' });
    const stranger = await ctx.signIn('stranger@example.com');
    expect((await call('POST', '/trips', stranger.accessToken, { name: 'x', destination: 'x', copyMembersFrom: tripId })).statusCode).toBe(404);
  });
});

describe('journal pushes', () => {
  // 20:35 in India (UTC+5:30) on 2 November, day 2 of the trip.
  const EVENING = new Date('2026-11-02T15:05:00Z');

  it('asks in the evening on the trip’s clock, once, unless you’ve written', async () => {
    const { tripId, alex } = await setup();
    const { push, sent } = recorder();
    expect(await queueJournalPrompts({ db: ctx.db, push }, new Date('2026-11-02T14:55:00Z'))).toEqual({ sent: 0 });
    expect(await queueJournalPrompts({ db: ctx.db, push }, EVENING)).toEqual({ sent: 1 });
    expect(sent).toEqual([
      {
        to: 'ExponentPushToken[alex]',
        title: 'Goa',
        body: 'Best thing you ate today?',
        data: { url: `/trips/${tripId}/journal/2026-11-02` },
        sound: 'default',
        channelId: 'activity',
      },
    ]);
    expect(await queueJournalPrompts({ db: ctx.db, push }, new Date('2026-11-02T16:05:00Z'))).toEqual({ sent: 0 });

    // Day 3: written already, so no nudge. (Sam and Priya have no phone registered.)
    await write(tripId, alex.accessToken, { date: '2026-11-03' });
    expect(await queueJournalPrompts({ db: ctx.db, push }, new Date('2026-11-03T15:05:00Z'))).toEqual({ sent: 0 });
  });

  it('stays quiet when muted or turned off, and comes at the chosen time', async () => {
    const { tripId, alex } = await setup();
    const { push } = recorder();
    await call('PATCH', `/trips/${tripId}/notifications`, alex.accessToken, { mutedUntil: '2027-01-01T00:00:00Z' });
    expect(await queueJournalPrompts({ db: ctx.db, push }, EVENING)).toEqual({ sent: 0 });
    await call('PATCH', `/trips/${tripId}/notifications`, alex.accessToken, { mutedUntil: null });
    await call('PATCH', '/me/notifications', alex.accessToken, { journalTime: '21:30' });
    expect(await queueJournalPrompts({ db: ctx.db, push }, EVENING)).toEqual({ sent: 0 });
    expect(await queueJournalPrompts({ db: ctx.db, push }, new Date('2026-11-02T16:05:00Z'))).toEqual({ sent: 1 });
    await call('PATCH', '/me/notifications', alex.accessToken, { journal: false });
    expect(await queueJournalPrompts({ db: ctx.db, push }, new Date('2026-11-03T16:05:00Z'))).toEqual({ sent: 0 });
  });

  it('remembers past years’ trips for the people still on them', async () => {
    const { tripId, alex, sam } = await setup({ startDate: '2025-11-01', endDate: '2025-11-05' });
    await call('POST', '/me/devices/push-token', sam.accessToken, { token: 'ExponentPushToken[sam]', platform: 'android', timezone: 'Asia/Kolkata' });
    await call('DELETE', `/trips/${tripId}/members/${sam.userId}`, sam.accessToken);
    // This year's trip isn't a memory yet.
    await call('POST', '/trips', alex.accessToken, { name: 'Goa 2026', destination: 'Goa', startDate: '2026-11-01', endDate: '2026-11-03' });
    const { push, sent } = recorder();
    // 10:30 in India on 2 November 2026.
    expect(await queueMemories({ db: ctx.db, push }, new Date('2026-11-02T05:00:00Z'))).toEqual({ sent: 1 });
    expect(sent[0]).toMatchObject({ to: 'ExponentPushToken[alex]', body: 'A year ago today you were in Goa', data: { url: `/trips/${tripId}/journal/2025-11-02` } });
    expect(await queueMemories({ db: ctx.db, push }, new Date('2026-11-02T08:00:00Z'))).toEqual({ sent: 0 });

    const card = (await call('GET', '/me/memories?today=2026-11-02', alex.accessToken)).json<MemoryList>();
    expect(card.memories).toEqual([expect.objectContaining({ tripId, yearsAgo: 1, date: '2025-11-02' })]);
    expect((await call('GET', '/me/memories?today=2026-11-02', sam.accessToken)).json<MemoryList>().memories).toEqual([]);
  });

  it('says the recap is ready the morning after the trip', async () => {
    const { tripId } = await setup();
    const { push, sent } = recorder();
    expect(await queueRecaps({ db: ctx.db, push }, new Date('2026-11-06T03:00:00Z'))).toEqual({ sent: 0 });
    expect(await queueRecaps({ db: ctx.db, push }, new Date('2026-11-06T03:45:00Z'))).toEqual({ sent: 1 });
    expect(sent[0]).toMatchObject({ body: 'Your Goa recap is ready ✨', data: { url: `/trips/${tripId}/recap` } });
    expect(await queueRecaps({ db: ctx.db, push }, new Date('2026-11-06T05:45:00Z'))).toEqual({ sent: 0 });
  });
});
