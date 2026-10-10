import type { ChatMessage, Photo, PhotoList, PhotoUpload } from '@tagalong/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processThumbnail } from '../src/jobs/thumbnail';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const editor = await joinTrip(ctx, tripId, owner.accessToken, 'editor@example.com', 'editor');
  const viewer = await joinTrip(ctx, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
  return { owner, editor, viewer, tripId };
};

/** A real JPEG, so the thumbnail job has something to decode. */
const jpeg = (width = 1200, height = 900, orientation?: number) => {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 14, g: 107, b: 92 } },
  }).jpeg();
  return (orientation ? image.withMetadata({ orientation }) : image).toBuffer();
};

const start = (tripId: string, token: string, body: Record<string, unknown> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/photos`,
    headers: bearer(token),
    payload: {
      batchId: crypto.randomUUID(),
      contentType: 'image/jpeg',
      sizeBytes: 250_000,
      width: 1200,
      height: 900,
      takenAt: '2026-06-12T18:30:00',
      latitude: 38.7139,
      longitude: -9.1334,
      ...body,
    },
  });

/** The whole upload: link, bytes, confirm. Returns the confirmed photo. */
const upload = async (tripId: string, token: string, body: Record<string, unknown> = {}) => {
  const bytes = await jpeg();
  // Declare the real size: the server checks what arrives matches it.
  const started = await start(tripId, token, { sizeBytes: bytes.length, ...body });
  expect(started.statusCode).toBe(201);
  const { photo, uploadUrl } = started.json<PhotoUpload>();
  ctx.putObject(uploadUrl, 0, bytes);
  const done = await ctx.app.inject({
    method: 'POST',
    url: `/photos/${photo.id}/complete`,
    headers: bearer(token),
  });
  expect(done.statusCode).toBe(200);
  return done.json<Photo>();
};

const album = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/trips/${tripId}/photos`,
    headers: bearer(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<PhotoList>().photos;
};

const worker = () => ({ db: ctx.db, redis: ctx.redis, storage: ctx.storage });

describe('photo uploads', () => {
  it('shows a confirmed photo to everyone, with when and where it was taken', async () => {
    const { owner, viewer, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);

    expect(photo).toMatchObject({
      status: 'ready',
      takenAt: '2026-06-12T18:30:00',
      latitude: 38.7139,
      longitude: -9.1334,
    });
    const seen = await album(tripId, viewer.accessToken);
    expect(seen.map((p) => p.id)).toEqual([photo.id]);
    expect(seen[0]?.url).toContain('https://storage.test/get/');
  });

  it("keeps the camera's clock time exactly, with no timezone shift", async () => {
    const { owner, tripId } = await setup();
    // A late-evening photo is the classic victim of a UTC conversion: it
    // would slide into the next day. It must stay on the 12th at 23:45.
    const photo = await upload(tripId, owner.accessToken, { takenAt: '2026-06-12T23:45:10' });
    expect(photo.takenAt).toBe('2026-06-12T23:45:10');
  });

  it("won't confirm a photo that never arrived", async () => {
    const { owner, tripId } = await setup();
    const { photo } = (await start(tripId, owner.accessToken)).json<PhotoUpload>();
    const done = await ctx.app.inject({
      method: 'POST',
      url: `/photos/${photo.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode).toBe(400);
    expect(ctx.thumbnails).toHaveLength(0);
  });

  it("won't accept something other than what the phone said it was sending", async () => {
    const { owner, tripId } = await setup();
    const { photo, uploadUrl } = (await start(tripId, owner.accessToken, { sizeBytes: 412_337 })).json<PhotoUpload>();
    // What a real Android phone once sent: the text of an error, in place of the photo.
    ctx.putObject(uploadUrl, 0, Buffer.from('File not found'));

    const done = await ctx.app.inject({
      method: 'POST',
      url: `/photos/${photo.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode).toBe(400);
    expect(done.json<{ error: string }>().error).toBe('upload_incomplete');
    expect(ctx.thumbnails).toHaveLength(0);
    expect(await album(tripId, (await ctx.signIn('owner@example.com')).accessToken)).toHaveLength(1);
  });

  it('refuses HEIC, which the server cannot read', async () => {
    const { owner, tripId } = await setup();
    const res = await start(tripId, owner.accessToken, { contentType: 'image/heic' });
    expect(res.statusCode).toBe(400);
  });

  it('refuses half a location', async () => {
    const { owner, tripId } = await setup();
    const res = await start(tripId, owner.accessToken, { longitude: null });
    expect(res.statusCode).toBe(400);
  });

  it('hides a photo still uploading from everyone but its uploader', async () => {
    const { owner, editor, tripId } = await setup();
    await start(tripId, owner.accessToken);
    expect(await album(tripId, editor.accessToken)).toHaveLength(0);
    expect(await album(tripId, owner.accessToken)).toHaveLength(1);
  });

  it('lists photos by when they were taken, not when they were uploaded', async () => {
    const { owner, tripId } = await setup();
    await upload(tripId, owner.accessToken, { takenAt: '2026-06-14T09:00:00' });
    await upload(tripId, owner.accessToken, { takenAt: '2026-06-12T09:00:00' });
    await upload(tripId, owner.accessToken, { takenAt: '2026-06-13T09:00:00' });

    const taken = (await album(tripId, owner.accessToken)).map((p) => p.takenAt);
    expect(taken).toEqual(['2026-06-12T09:00:00', '2026-06-13T09:00:00', '2026-06-14T09:00:00']);
  });

  it('lets a viewer look but not add', async () => {
    const { viewer, tripId } = await setup();
    expect((await start(tripId, viewer.accessToken)).statusCode).toBe(403);
  });

  it('hides the album from someone who is not on the trip', async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);
    const stranger = await ctx.signIn('stranger@example.com');

    const list = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/photos`,
      headers: bearer(stranger.accessToken),
    });
    const one = await ctx.app.inject({
      method: 'GET',
      url: `/photos/${photo.id}`,
      headers: bearer(stranger.accessToken),
    });
    expect(list.statusCode).toBe(404);
    expect(one.statusCode).toBe(404);
  });
});

describe('batches', () => {
  it('posts one chat card for a whole batch, and only once', async () => {
    const { owner, tripId } = await setup();
    const batchId = crypto.randomUUID();
    for (let i = 0; i < 3; i++) await upload(tripId, owner.accessToken, { batchId });

    const finish = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/photo-batches/${batchId}/finish`,
        headers: bearer(owner.accessToken),
      });
    // A double tap, sent at the same moment.
    const [a, b] = await Promise.all([finish(), finish()]);
    expect([a.json().posted, b.json().posted].sort()).toEqual([false, true]);

    const feed = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
    });
    const cards = feed
      .json<{ messages: ChatMessage[] }>()
      .messages.filter((m) => m.body.includes('photos'));
    expect(cards).toHaveLength(1);
    expect(cards[0]?.body).toMatch(/added 3 photos$/);
  });

  it('refuses a second card for the same batch, whatever the timing', async () => {
    const { owner, tripId } = await setup();
    const batchId = crypto.randomUUID();
    await upload(tripId, owner.accessToken, { batchId });
    const finish = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/photo-batches/${batchId}/finish`,
        headers: bearer(owner.accessToken),
      });

    expect((await finish()).json()).toMatchObject({ posted: true, count: 1 });
    // Nothing checks first, so this one reaches the database: the unique
    // index is what turns it away.
    const again = await finish();
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ posted: false, count: 1 });
  });

  it('posts nothing for a batch where nothing finished uploading', async () => {
    const { owner, tripId } = await setup();
    const batchId = crypto.randomUUID();
    await start(tripId, owner.accessToken, { batchId });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/photo-batches/${batchId}/finish`,
      headers: bearer(owner.accessToken),
    });
    expect(res.json()).toMatchObject({ posted: false, count: 0 });
  });
});

describe('thumbnails', () => {
  it('queues a thumbnail when a photo is confirmed', async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);
    expect(ctx.thumbnails).toEqual([photo.id]);
  });

  it('makes a small WebP preview from the real image', async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);

    const result = await processThumbnail(worker(), { photoId: photo.id });
    expect(result).toMatchObject({ made: true, width: 1200, height: 900 });

    const [listed] = await album(tripId, owner.accessToken);
    expect(listed?.thumbUrl).toContain('thumb.webp');

    const thumbKey = `trips/${tripId}/photos/${photo.id}/thumb.webp`;
    const meta = await sharp((await ctx.storage.read(thumbKey))!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(480);
    expect(meta.height).toBe(360);
  });

  it('turns a sideways phone photo the right way up', async () => {
    const { owner, tripId } = await setup();
    // Stored landscape, tagged "rotate 90°": the way phones save a portrait shot.
    const sideways = await jpeg(1200, 900, 6);
    const started = await start(tripId, owner.accessToken, { sizeBytes: sideways.length });
    const { photo, uploadUrl } = started.json<PhotoUpload>();
    ctx.putObject(uploadUrl, 0, sideways);
    await ctx.app.inject({
      method: 'POST',
      url: `/photos/${photo.id}/complete`,
      headers: bearer(owner.accessToken),
    });

    const result = await processThumbnail(worker(), { photoId: photo.id });
    expect(result).toMatchObject({ made: true, width: 900, height: 1200 });
    const thumb = await sharp(
      (await ctx.storage.read(`trips/${tripId}/photos/${photo.id}/thumb.webp`))!,
    ).metadata();
    expect(thumb.height! > thumb.width!).toBe(true);
  });

  it('skips a photo that was deleted, and one already done', async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);
    expect(await processThumbnail(worker(), { photoId: photo.id })).toMatchObject({ made: true });
    expect(await processThumbnail(worker(), { photoId: photo.id })).toEqual({ skipped: 'already_done' });

    await ctx.app.inject({
      method: 'DELETE',
      url: `/photos/${photo.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(await processThumbnail(worker(), { photoId: photo.id })).toEqual({ skipped: 'gone' });
  });
});

describe('deleting', () => {
  it('lets the uploader or an owner delete, and removes the files too', async () => {
    const { owner, editor, tripId } = await setup();
    const mine = await upload(tripId, editor.accessToken);
    const theirs = await upload(tripId, editor.accessToken);
    await processThumbnail(worker(), { photoId: theirs.id });

    const byUploader = await ctx.app.inject({
      method: 'DELETE',
      url: `/photos/${mine.id}`,
      headers: bearer(editor.accessToken),
    });
    const byOwner = await ctx.app.inject({
      method: 'DELETE',
      url: `/photos/${theirs.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(byUploader.statusCode).toBe(204);
    expect(byOwner.statusCode).toBe(204);
    expect(await album(tripId, owner.accessToken)).toHaveLength(0);
    expect(await ctx.storage.read(`trips/${tripId}/photos/${theirs.id}/original.jpg`)).toBeNull();
    expect(await ctx.storage.read(`trips/${tripId}/photos/${theirs.id}/thumb.webp`)).toBeNull();
  });

  it("doesn't let another editor delete someone else's photo", async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);
    const other = await joinTrip(ctx, tripId, owner.accessToken, 'other@example.com', 'editor');

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/photos/${photo.id}`,
      headers: bearer(other.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('favourites', () => {
  const heart = (photoId: string, token: string, on = true) =>
    ctx.app.inject({
      method: on ? 'PUT' : 'DELETE',
      url: `/photos/${photoId}/favourite`,
      headers: bearer(token),
    });

  it('counts one heart per person, and knows which are mine', async () => {
    const { owner, editor, viewer, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);

    await heart(photo.id, editor.accessToken);
    await heart(photo.id, editor.accessToken); // twice is still one
    const res = await heart(photo.id, viewer.accessToken); // viewers may heart too
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ favourites: 2, favourited: true });

    const [asViewer] = await album(tripId, viewer.accessToken);
    const [asOwner] = await album(tripId, owner.accessToken);
    expect(asViewer).toMatchObject({ favourites: 2, favourited: true });
    expect(asOwner).toMatchObject({ favourites: 2, favourited: false });
  });

  it('takes a heart back', async () => {
    const { owner, editor, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);
    await heart(photo.id, editor.accessToken);
    const res = await heart(photo.id, editor.accessToken, false);
    expect(res.json()).toEqual({ favourites: 0, favourited: false });
  });

  it("won't let a stranger heart a photo", async () => {
    const { owner, tripId } = await setup();
    const photo = await upload(tripId, owner.accessToken);
    const stranger = await ctx.signIn('stranger@example.com');
    expect((await heart(photo.id, stranger.accessToken)).statusCode).toBe(404);
  });
});

describe("a plan item's photos", () => {
  const addItem = async (tripId: string, token: string, body: Record<string, unknown>) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: bearer(token),
      payload: { title: 'Sintra day trip', ...body },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  };
  const itemPhotos = async (itemId: string, token: string) => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/items/${itemId}/photos`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    return res.json<PhotoList>().photos.map((p) => p.takenAt);
  };

  it('shows the photos taken during it, and none from either side', async () => {
    const { owner, tripId } = await setup();
    const itemId = await addItem(tripId, owner.accessToken, {
      date: '2027-06-13',
      startTime: '10:00',
      endTime: '13:30',
    });
    for (const takenAt of [
      '2027-06-13T09:59:00', // just before
      '2027-06-13T10:00:00', // the first minute
      '2027-06-13T12:15:00',
      '2027-06-13T13:30:40', // the last minute
      '2027-06-13T13:31:00', // just after
      '2027-06-14T11:00:00', // same time, wrong day
    ]) {
      await upload(tripId, owner.accessToken, { takenAt });
    }
    expect(await itemPhotos(itemId, owner.accessToken)).toEqual([
      '2027-06-13T10:00:00',
      '2027-06-13T12:15:00',
      '2027-06-13T13:30:40',
    ]);
  });

  it('follows an evening past midnight', async () => {
    const { owner, tripId } = await setup();
    const itemId = await addItem(tripId, owner.accessToken, {
      title: 'Fado night',
      date: '2027-06-14',
      startTime: '22:00',
      endTime: '01:00',
    });
    await upload(tripId, owner.accessToken, { takenAt: '2027-06-14T23:50:00' });
    await upload(tripId, owner.accessToken, { takenAt: '2027-06-15T00:40:00' });
    await upload(tripId, owner.accessToken, { takenAt: '2027-06-15T09:00:00' });
    expect(await itemPhotos(itemId, owner.accessToken)).toEqual([
      '2027-06-14T23:50:00',
      '2027-06-15T00:40:00',
    ]);
  });

  it("claims nothing for an item with no time, rather than its whole day", async () => {
    const { owner, tripId } = await setup();
    const itemId = await addItem(tripId, owner.accessToken, { date: '2027-06-13' });
    await upload(tripId, owner.accessToken, { takenAt: '2027-06-13T12:00:00' });
    expect(await itemPhotos(itemId, owner.accessToken)).toEqual([]);
  });

  it("doesn't show another trip's photos taken at the same time", async () => {
    const { owner, tripId } = await setup();
    const otherTrip = await createTrip(ctx.app, owner.accessToken, 'Porto');
    const itemId = await addItem(tripId, owner.accessToken, {
      date: '2027-06-13',
      startTime: '10:00',
      endTime: '13:00',
    });
    await upload(otherTrip, owner.accessToken, { takenAt: '2027-06-13T11:00:00' });
    expect(await itemPhotos(itemId, owner.accessToken)).toEqual([]);
  });
});
