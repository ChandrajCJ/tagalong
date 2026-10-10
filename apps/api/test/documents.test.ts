import type { DocumentUpload, TripDocument } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const editor = await joinTrip(ctx, tripId, owner.accessToken, 'editor@example.com', 'editor');
  const viewer = await joinTrip(ctx, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
  return { owner, editor, viewer, tripId };
};

const start = (tripId: string, token: string, body: Record<string, unknown> = {}) =>
  ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/documents`,
    headers: bearer(token),
    payload: {
      name: 'Lisbon return flight.pdf',
      contentType: 'application/pdf',
      sizeBytes: 120_000,
      kind: 'flight',
      ...body,
    },
  });

/** The whole upload: ask for a link, "send" the bytes, then confirm. */
const upload = async (tripId: string, token: string, body: Record<string, unknown> = {}) => {
  const started = await start(tripId, token, body);
  expect(started.statusCode).toBe(201);
  const { document, uploadUrl } = started.json<DocumentUpload>();
  ctx.putObject(uploadUrl, 120_000);
  const done = await ctx.app.inject({
    method: 'POST',
    url: `/documents/${document.id}/complete`,
    headers: bearer(token),
  });
  expect(done.statusCode).toBe(200);
  return done.json<TripDocument>();
};

const list = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/trips/${tripId}/documents`,
    headers: bearer(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ documents: TripDocument[] }>().documents;
};

describe('documents', () => {
  it('uploads in two steps and shows the file to everyone on the trip', async () => {
    const { owner, viewer, tripId } = await setup();
    const doc = await upload(tripId, owner.accessToken);

    expect(doc).toMatchObject({ name: 'Lisbon return flight.pdf', kind: 'flight', status: 'ready' });
    expect(doc.sizeBytes).toBe(120_000);

    const seen = await list(tripId, viewer.accessToken);
    expect(seen.map((d) => d.id)).toEqual([doc.id]);
    expect(seen[0]?.uploaderName).toBeTruthy();
  });

  it("won't finish an upload that never arrived", async () => {
    const { owner, tripId } = await setup();
    const started = await start(tripId, owner.accessToken);
    const { document } = started.json<DocumentUpload>();

    // No putObject: the phone claims it's done, but storage is empty.
    const done = await ctx.app.inject({
      method: 'POST',
      url: `/documents/${document.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode).toBe(400);
    expect(done.json<{ error: string }>().error).toBe('upload_missing');
  });

  it("won't accept something other than what the phone said it was sending", async () => {
    const { owner, tripId } = await setup();
    const { document, uploadUrl } = (await start(tripId, owner.accessToken)).json<DocumentUpload>();
    ctx.putObject(uploadUrl, 14); // declared 120,000 bytes; 14 arrived
    const done = await ctx.app.inject({
      method: 'POST',
      url: `/documents/${document.id}/complete`,
      headers: bearer(owner.accessToken),
    });
    expect(done.statusCode).toBe(400);
    expect(done.json<{ error: string }>().error).toBe('upload_incomplete');
  });

  it('hides an unfinished upload from everyone but the person uploading it', async () => {
    const { owner, editor, tripId } = await setup();
    await start(tripId, owner.accessToken);

    expect(await list(tripId, editor.accessToken)).toHaveLength(0);
    const mine = await list(tripId, owner.accessToken);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.status).toBe('pending');
  });

  it('gives back the same file when an upload is retried with the same id', async () => {
    const { owner, tripId } = await setup();
    const id = crypto.randomUUID();
    const first = await start(tripId, owner.accessToken, { id });
    const second = await start(tripId, owner.accessToken, { id });

    expect(second.json<DocumentUpload>().document.id).toBe(id);
    expect(second.json<DocumentUpload>().uploadUrl).toBe(first.json<DocumentUpload>().uploadUrl);
    expect(await list(tripId, owner.accessToken)).toHaveLength(1);
  });

  it('refuses files that are too big or the wrong type', async () => {
    const { owner, tripId } = await setup();
    const big = await start(tripId, owner.accessToken, { sizeBytes: 40 * 1024 * 1024 });
    const wrong = await start(tripId, owner.accessToken, { contentType: 'application/zip' });

    expect(big.statusCode).toBe(400);
    expect(wrong.statusCode).toBe(400);
  });

  it('lets a viewer read a file but not add one', async () => {
    const { owner, viewer, tripId } = await setup();
    const doc = await upload(tripId, owner.accessToken);

    expect((await start(tripId, viewer.accessToken)).statusCode).toBe(403);

    const link = await ctx.app.inject({
      method: 'GET',
      url: `/documents/${doc.id}/url`,
      headers: bearer(viewer.accessToken),
    });
    expect(link.statusCode).toBe(200);
    expect(link.json<{ url: string }>().url).toContain('https://storage.test/get/');
  });

  it('posts an activity card in the chat when a file lands', async () => {
    const { owner, tripId } = await setup();
    await upload(tripId, owner.accessToken);

    const messages = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
    });
    const card = messages
      .json<{ messages: { kind: string; body: string }[] }>()
      .messages.find((m) => m.body.includes('Lisbon return flight.pdf'));
    expect(card?.kind).toBe('system');
  });

  it('renames with a version check, and answers 409 when it is stale', async () => {
    const { owner, editor, tripId } = await setup();
    const doc = await upload(tripId, owner.accessToken);

    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/documents/${doc.id}`,
      headers: bearer(editor.accessToken),
      payload: { name: 'Flight out.pdf', version: doc.version },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<TripDocument>().name).toBe('Flight out.pdf');

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/documents/${doc.id}`,
      headers: bearer(owner.accessToken),
      payload: { name: 'Something else.pdf', version: doc.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ current: TripDocument }>().current.name).toBe('Flight out.pdf');
  });

  it('lets the uploader or an owner delete, but not another editor', async () => {
    const { owner, editor, tripId } = await setup();
    const theirs = await upload(tripId, editor.accessToken, { name: 'Hotel.pdf' });
    const mine = await upload(tripId, editor.accessToken, { name: 'Museum ticket.pdf' });

    // The owner may remove someone else's file.
    const byOwner = await ctx.app.inject({
      method: 'DELETE',
      url: `/documents/${theirs.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(byOwner.statusCode).toBe(204);

    // The uploader may remove their own.
    const byUploader = await ctx.app.inject({
      method: 'DELETE',
      url: `/documents/${mine.id}`,
      headers: bearer(editor.accessToken),
    });
    expect(byUploader.statusCode).toBe(204);
    expect(await list(tripId, owner.accessToken)).toHaveLength(0);
  });

  it("doesn't let another editor delete someone else's file", async () => {
    const { owner, editor, tripId } = await setup();
    const doc = await upload(tripId, owner.accessToken);
    const second = await joinTrip(ctx, tripId, owner.accessToken, 'other@example.com', 'editor');
    void editor;

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/documents/${doc.id}`,
      headers: bearer(second.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it('hides the whole shelf from someone who is not on the trip', async () => {
    const { owner, tripId } = await setup();
    const doc = await upload(tripId, owner.accessToken);
    const stranger = await ctx.signIn('stranger@example.com');

    const docs = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/documents`,
      headers: bearer(stranger.accessToken),
    });
    const link = await ctx.app.inject({
      method: 'GET',
      url: `/documents/${doc.id}/url`,
      headers: bearer(stranger.accessToken),
    });
    expect(docs.statusCode).toBe(404);
    expect(link.statusCode).toBe(404);
  });
});
