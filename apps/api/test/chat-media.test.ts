import { photos } from '@tagalong/db';
import type { ChatMessage, MessagePage, Photo, PhotoList, PhotoUpload } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('photos in chat', () => {
  const t = useTestApp();

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
    return { owner, sam, viewer, tripId };
  };

  /** Uploads one photo the way the phone does, to the chat by default. */
  const upload = async (tripId: string, token: string, source: 'chat' | 'album' = 'chat') => {
    const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0E6B5C' } }).jpeg().toBuffer();
    const started = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/photos`,
      headers: bearer(token),
      payload: { batchId: crypto.randomUUID(), contentType: 'image/jpeg', sizeBytes: bytes.length, width: 400, height: 300, source },
    });
    expect(started.statusCode).toBe(201);
    const { photo, uploadUrl } = started.json<PhotoUpload>();
    t.putObject(uploadUrl, 0, bytes);
    const done = await t.app.inject({ method: 'POST', url: `/photos/${photo.id}/complete`, headers: bearer(token) });
    expect(done.statusCode).toBe(200);
    return done.json<Photo>();
  };

  const send = (tripId: string, token: string, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/messages`, headers: bearer(token), payload });
  const album = async (tripId: string, token: string) =>
    (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/photos`, headers: bearer(token) })).json<PhotoList>().photos;

  it('sends photos with a caption, kept out of the album', async () => {
    const { sam, viewer, tripId } = await setup();
    const a = await upload(tripId, sam.accessToken);
    const b = await upload(tripId, sam.accessToken);

    const res = await send(tripId, sam.accessToken, { body: 'Sunset!', mediaIds: [a.id, b.id] });
    expect(res.statusCode).toBe(201);
    const message = res.json<ChatMessage>();
    expect(message).toMatchObject({ kind: 'image', body: 'Sunset!' });
    expect(message.images.map((i) => i.id)).toEqual([a.id, b.id]);
    expect(message.images[0]).toMatchObject({ inAlbum: false, url: expect.stringContaining('https://storage.test/get/') });

    // Viewers see them in the chat; nobody sees them in the album.
    const page = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(viewer.accessToken) });
    expect(page.json<MessagePage>().messages[0]!.images).toHaveLength(2);
    expect(await album(tripId, viewer.accessToken)).toEqual([]);
  });

  it('can be added to the album afterwards', async () => {
    const { sam, owner, tripId } = await setup();
    const a = await upload(tripId, sam.accessToken);
    await send(tripId, sam.accessToken, { mediaIds: [a.id] });
    const res = await t.app.inject({ method: 'POST', url: `/photos/${a.id}/album`, headers: bearer(owner.accessToken) });
    expect(res.json<Photo>().source).toBe('album');
    expect((await album(tripId, owner.accessToken)).map((p) => p.id)).toEqual([a.id]);
  });

  it('only sends your own finished photos from this trip', async () => {
    const { owner, sam, tripId } = await setup();
    const ownersPhoto = await upload(tripId, owner.accessToken);
    expect((await send(tripId, sam.accessToken, { mediaIds: [ownersPhoto.id] })).statusCode).toBe(400);

    const elsewhere = await createTrip(t.app, sam.accessToken, 'Porto');
    const fromPorto = await upload(elsewhere, sam.accessToken);
    expect((await send(tripId, sam.accessToken, { mediaIds: [fromPorto.id] })).statusCode).toBe(400);

    const tooMany = Array.from({ length: 11 }, () => crypto.randomUUID());
    expect((await send(tripId, sam.accessToken, { mediaIds: tooMany })).statusCode).toBe(400);
    expect((await send(tripId, sam.accessToken, { body: '' })).statusCode).toBe(400);
  });

  it('takes chat-only photos with it when deleted, but leaves album ones', async () => {
    const { sam, tripId } = await setup();
    const chatOnly = await upload(tripId, sam.accessToken);
    const inAlbum = await upload(tripId, sam.accessToken, 'album');
    const message = (await send(tripId, sam.accessToken, { mediaIds: [chatOnly.id, inAlbum.id] })).json<ChatMessage>();

    const [stored] = await t.db.select().from(photos).where(eq(photos.id, chatOnly.id));
    expect(await t.storage.sizeOf(stored!.storageKey)).not.toBeNull();

    await t.app.inject({ method: 'DELETE', url: `/messages/${message.id}`, headers: bearer(sam.accessToken) });
    const [gone] = await t.db.select().from(photos).where(eq(photos.id, chatOnly.id));
    expect(gone?.deletedAt).not.toBeNull();
    expect(await t.storage.sizeOf(stored!.storageKey)).toBeNull();
    const [kept] = await t.db.select().from(photos).where(eq(photos.id, inAlbum.id));
    expect(kept?.deletedAt).toBeNull();
    expect((await album(tripId, sam.accessToken)).map((p) => p.id)).toEqual([inAlbum.id]);
  });

  it('doesn’t announce chat photos to the album or post an "added photos" card', async () => {
    const { sam, tripId } = await setup();
    const photo = await upload(tripId, sam.accessToken);
    const finished = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/photo-batches/${photo.batchId}/finish`,
      headers: bearer(sam.accessToken),
    });
    expect(finished.json()).toEqual({ posted: false, count: 0 });
  });
});

describe('@mentions', () => {
  const t = useTestApp();

  it('keeps only people on the trip, and tells them right away', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const stranger = await t.signIn('stranger@example.com');
    const strangerId = (await t.app.inject({ method: 'GET', url: '/me', headers: bearer(stranger.accessToken) })).json<{ id: string }>().id;
    const ownerId = (await t.app.inject({ method: 'GET', url: '/me', headers: bearer(owner.accessToken) })).json<{ id: string }>().id;

    const res = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
      payload: { body: '@sam can you book?', mentions: [sam.userId, strangerId, ownerId] },
    });
    const message = res.json<ChatMessage>();
    expect(message.payload).toEqual({ mentions: [sam.userId] });
    expect(t.mentioned).toEqual([{ tripId, messageId: message.id, userId: sam.userId }]);
  });

  it('survive an edit, and only newly mentioned people are told again', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const alex = await joinTrip(t, tripId, owner.accessToken, 'alex@example.com');
    const message = (
      await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/messages`,
        headers: bearer(owner.accessToken),
        payload: { body: '@sam book?', mentions: [sam.userId] },
      })
    ).json<ChatMessage>();

    const plain = await t.app.inject({ method: 'PATCH', url: `/messages/${message.id}`, headers: bearer(owner.accessToken), payload: { body: '@sam book it?' } });
    expect(plain.json<ChatMessage>().payload).toEqual({ mentions: [sam.userId] });

    t.mentioned.length = 0;
    const more = await t.app.inject({
      method: 'PATCH',
      url: `/messages/${message.id}`,
      headers: bearer(owner.accessToken),
      payload: { body: '@sam @alex book it?', mentions: [sam.userId, alex.userId] },
    });
    expect(more.json<ChatMessage>().payload).toEqual({ mentions: [sam.userId, alex.userId] });
    expect(t.mentioned.map((m) => m.userId)).toEqual([alex.userId]);
  });

  it('asks for a link preview only when there is a link', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const post = (body: string) =>
      t.app.inject({ method: 'POST', url: `/trips/${tripId}/messages`, headers: bearer(owner.accessToken), payload: { body } });
    await post('no link here');
    const linked = (await post('look https://example.com/hotel')).json<ChatMessage>();
    expect(t.previews).toEqual([linked.id]);
  });
});
