import { photos } from '@tagalong/db';
import type { Photo, PhotoList, PhotoUpload } from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, useTestApp } from './helpers';

describe('videos in the album', () => {
  const t = useTestApp();

  const start = (tripId: string, token: string, body: Record<string, unknown> = {}) =>
    t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/photos`,
      headers: bearer(token),
      payload: {
        batchId: crypto.randomUUID(),
        kind: 'video',
        contentType: 'video/mp4',
        sizeBytes: 8_000_000,
        durationMs: 12_500,
        width: 1080,
        height: 1920,
        ...body,
      },
    });
  const complete = (photoId: string, token: string) =>
    t.app.inject({ method: 'POST', url: `/photos/${photoId}/complete`, headers: bearer(token) });

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    return { owner, tripId: await createTrip(t.app, owner.accessToken) };
  };

  it('refuses videos over 50 MB or a minute, and needs a length', async () => {
    const { owner, tripId } = await setup();
    expect((await start(tripId, owner.accessToken, { sizeBytes: 60 * 1024 * 1024 })).statusCode).toBe(400);
    expect((await start(tripId, owner.accessToken, { durationMs: 61_000 })).statusCode).toBe(400);
    expect((await start(tripId, owner.accessToken, { durationMs: undefined })).statusCode).toBe(400);
    // A video type with kind "photo" (or the other way round) is turned away too.
    expect((await start(tripId, owner.accessToken, { kind: 'photo' })).statusCode).toBe(400);
    // Photos keep their own 25 MB limit.
    expect(
      (await start(tripId, owner.accessToken, { kind: 'photo', contentType: 'image/jpeg', sizeBytes: 30 * 1024 * 1024, durationMs: undefined }))
        .statusCode,
    ).toBe(400);
  });

  it('stores the kind and length, and needs the poster before it shows', async () => {
    const { owner, tripId } = await setup();
    const started = await start(tripId, owner.accessToken);
    expect(started.statusCode).toBe(201);
    const { photo, uploadUrl, posterUploadUrl } = started.json<PhotoUpload>();
    expect(posterUploadUrl).toContain('poster.jpg');
    t.putObject(uploadUrl, 8_000_000);

    const early = await complete(photo.id, owner.accessToken);
    expect(early.statusCode).toBe(400);
    expect(early.json()).toMatchObject({ error: 'poster_missing' });

    t.putObject(posterUploadUrl!, 40_000);
    const done = await complete(photo.id, owner.accessToken);
    expect(done.json<Photo>()).toMatchObject({ kind: 'video', durationMs: 12_500, status: 'ready', thumbUrl: expect.stringContaining('poster') });
    // The server never touches the video: no thumbnail job.
    expect(t.thumbnails).toEqual([]);

    const album = (await t.app.inject({ method: 'GET', url: `/trips/${tripId}/photos`, headers: bearer(owner.accessToken) })).json<PhotoList>();
    expect(album.photos.map((p) => p.kind)).toEqual(['video']);
  });

  it('deletes both the video and its poster', async () => {
    const { owner, tripId } = await setup();
    const { photo, uploadUrl, posterUploadUrl } = (await start(tripId, owner.accessToken)).json<PhotoUpload>();
    t.putObject(uploadUrl, 8_000_000);
    t.putObject(posterUploadUrl!, 40_000);
    await complete(photo.id, owner.accessToken);
    const [row] = await t.db.select().from(photos).where(eq(photos.id, photo.id));

    await t.app.inject({ method: 'DELETE', url: `/photos/${photo.id}`, headers: bearer(owner.accessToken) });
    expect(await t.storage.sizeOf(row!.storageKey)).toBeNull();
    expect(await t.storage.sizeOf(row!.thumbKey!)).toBeNull();
  });
});
