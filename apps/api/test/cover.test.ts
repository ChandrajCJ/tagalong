import { photos } from '@tagalong/db';
import type { MyTrips, Photo, PhotoUpload, Trip } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('trip cover photos', () => {
  const t = useTestApp();

  const jpeg = () => sharp({ create: { width: 1600, height: 900, channels: 3, background: '#D8A47F' } }).jpeg().toBuffer();

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const editor = await joinTrip(t, tripId, owner.accessToken, 'editor@example.com');
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
    return { owner, editor, viewer, tripId };
  };

  const upload = async (tripId: string, token: string, source: 'cover' | 'album' | 'chat') => {
    const bytes = await jpeg();
    const started = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/photos`,
      headers: bearer(token),
      payload: { batchId: crypto.randomUUID(), contentType: 'image/jpeg', sizeBytes: bytes.length, width: 1600, height: 900, source },
    });
    const { photo, uploadUrl } = started.json<PhotoUpload>();
    t.putObject(uploadUrl, 0, bytes);
    await t.app.inject({ method: 'POST', url: `/photos/${photo.id}/complete`, headers: bearer(token) });
    return photo as Photo;
  };

  const setCover = (tripId: string, token: string, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'PUT', url: `/trips/${tripId}/cover`, headers: bearer(token), payload });
  const keyOf = async (photoId: string) => (await t.db.select().from(photos).where(eq(photos.id, photoId)))[0]!;

  it('lets editors set an uploaded photo, shown to everyone on the card and the trip', async () => {
    const { editor, viewer, tripId } = await setup();
    const photo = await upload(tripId, editor.accessToken, 'cover');
    const res = await setCover(tripId, editor.accessToken, { photoId: photo.id });
    expect(res.statusCode).toBe(200);
    expect(res.json<Trip>()).toMatchObject({ coverPhotoId: photo.id, coverUrl: expect.stringContaining('storage.test') });

    const list = (await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(viewer.accessToken) })).json<MyTrips>();
    expect(list.trips[0]?.coverUrl).toContain('storage.test');
  });

  it('isn’t for viewers', async () => {
    const { owner, viewer, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken, 'album');
    expect((await setCover(tripId, viewer.accessToken, { photoId: photo.id })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}/cover`, headers: bearer(viewer.accessToken) })).statusCode).toBe(403);
  });

  it('must be a photo of this trip, and not one sent only in the chat', async () => {
    const { owner, tripId } = await setup();
    const other = await createTrip(t.app, owner.accessToken, 'Porto');
    const elsewhere = await upload(other, owner.accessToken, 'album');
    expect((await setCover(tripId, owner.accessToken, { photoId: elsewhere.id })).statusCode).toBe(400);
    const chatOnly = await upload(tripId, owner.accessToken, 'chat');
    expect((await setCover(tripId, owner.accessToken, { photoId: chatOnly.id })).statusCode).toBe(400);
    expect((await setCover(tripId, owner.accessToken, { wikipediaUrl: 'https://evil.example/x.jpg' })).statusCode).toBe(400);
  });

  it('takes the destination’s Wikipedia photo, keeping the credit', async () => {
    const { owner, tripId } = await setup();
    t.geo.answers.photo = { url: 'https://upload.wikimedia.org/a/lisbon.jpg', credit: 'Photo: Jane, CC BY-SA 4.0', pageUrl: null };
    t.geo.answers.image = { contentType: 'image/jpeg', body: await jpeg() };

    const suggestion = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/cover-suggestion`, headers: bearer(owner.accessToken) });
    expect(suggestion.json()).toEqual({ suggestion: t.geo.answers.photo });
    expect(t.geo.calls).toContain('photo:Lisbon');

    const res = await setCover(tripId, owner.accessToken, {
      wikipediaUrl: 'https://upload.wikimedia.org/a/lisbon.jpg',
      credit: 'Photo: Jane, CC BY-SA 4.0',
    });
    expect(res.json<Trip>()).toMatchObject({ coverCredit: 'Photo: Jane, CC BY-SA 4.0', coverUrl: expect.any(String) });
    const stored = await keyOf(res.json<Trip>().coverPhotoId!);
    expect(stored.source).toBe('cover');
    expect(await t.storage.sizeOf(stored.storageKey)).not.toBeNull();
    expect(t.thumbnails).toContain(stored.id);
  });

  it('removes a replaced cover-only photo, but never an album photo', async () => {
    const { owner, tripId } = await setup();
    const first = await upload(tripId, owner.accessToken, 'cover');
    await setCover(tripId, owner.accessToken, { photoId: first.id });
    const fromAlbum = await upload(tripId, owner.accessToken, 'album');
    await setCover(tripId, owner.accessToken, { photoId: fromAlbum.id });

    const old = await keyOf(first.id);
    expect(old.deletedAt).not.toBeNull();
    expect(await t.storage.sizeOf(old.storageKey)).toBeNull();

    const removed = await t.app.inject({ method: 'DELETE', url: `/trips/${tripId}/cover`, headers: bearer(owner.accessToken) });
    expect(removed.json<Trip>()).toMatchObject({ coverPhotoId: null, coverUrl: null });
    const album = await keyOf(fromAlbum.id);
    expect(album.deletedAt).toBeNull();
    expect(await t.storage.sizeOf(album.storageKey)).not.toBeNull();
  });

  it('falls back to the colour when the album photo on the cover is deleted', async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken, 'album');
    await setCover(tripId, owner.accessToken, { photoId: photo.id });
    await t.app.inject({ method: 'DELETE', url: `/photos/${photo.id}`, headers: bearer(owner.accessToken) });
    const trip = await t.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) });
    expect(trip.json<Trip>()).toMatchObject({ coverPhotoId: null, coverUrl: null });
  });
});
