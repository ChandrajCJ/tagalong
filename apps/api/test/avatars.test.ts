import type { AvatarUpload, Me, Trip } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(token), payload });

/** The phone's part: ask where, upload, then make it the profile photo. */
const uploadAvatar = async (token: string, size = 80_000) => {
  const upload = (await call('POST', '/me/avatar', token, { contentType: 'image/jpeg', size })).json<AvatarUpload>();
  ctx.putObject(upload.uploadUrl, size);
  const res = await call('PUT', '/me/avatar', token, { key: upload.key });
  return { upload, res };
};

describe('profile photos', () => {
  it('becomes the profile photo, with a version that changes with it', async () => {
    const me = await ctx.signIn('priya@example.com');
    const { upload, res } = await uploadAvatar(me.accessToken);
    expect(res.statusCode).toBe(200);
    const profile = res.json<Me>();
    expect(upload.key).toMatch(new RegExp(`^avatars/${profile.id}/[\\w-]+\\.jpg$`));
    expect(profile.avatarUrl).toContain(encodeURIComponent(upload.key));
    expect(profile.avatarVersion).toBe(upload.key.split('/').pop()!.replace('.jpg', ''));
  });

  it('deletes the old photo when replaced or removed', async () => {
    const me = await ctx.signIn('priya@example.com');
    const first = await uploadAvatar(me.accessToken);
    const second = await uploadAvatar(me.accessToken);
    expect(await ctx.storage.sizeOf(first.upload.key)).toBeNull();
    expect(second.res.json<Me>().avatarVersion).not.toBe(first.res.json<Me>().avatarVersion);
    const removed = await call('DELETE', '/me/avatar', me.accessToken);
    expect(removed.json<Me>()).toMatchObject({ avatarUrl: null, avatarVersion: null });
    expect(await ctx.storage.sizeOf(second.upload.key)).toBeNull();
  });

  it('takes only JPEG, PNG or WebP, up to 2 MB, from your own upload', async () => {
    const me = await ctx.signIn('priya@example.com');
    expect((await call('POST', '/me/avatar', me.accessToken, { contentType: 'image/gif', size: 1000 })).statusCode).toBe(400);
    expect((await call('POST', '/me/avatar', me.accessToken, { contentType: 'image/png', size: 3_000_000 })).statusCode).toBe(400);

    // Said it was small, uploaded something bigger: refused, and the file goes.
    const upload = (await call('POST', '/me/avatar', me.accessToken, { contentType: 'image/webp', size: 1000 })).json<AvatarUpload>();
    ctx.putObject(upload.uploadUrl, 3_000_000);
    const big = await call('PUT', '/me/avatar', me.accessToken, { key: upload.key });
    expect(big.statusCode).toBe(400);
    expect(await ctx.storage.sizeOf(upload.key)).toBeNull();

    const sam = await ctx.signIn('sam@example.com');
    const samsUpload = (await call('POST', '/me/avatar', sam.accessToken, { contentType: 'image/jpeg', size: 1000 })).json<AvatarUpload>();
    ctx.putObject(samsUpload.uploadUrl, 1000);
    expect((await call('PUT', '/me/avatar', me.accessToken, { key: samsUpload.key })).statusCode).toBe(400);
    expect((await call('PUT', '/me/avatar', me.accessToken, { key: `avatars/x/never-uploaded.jpg` })).statusCode).toBe(400);
  });

  it('shows to people who share a trip, and to no one else', async () => {
    const owner = await ctx.signIn('owner@example.com');
    const tripId = await createTrip(ctx.app, owner.accessToken);
    const sam = await joinTrip(ctx, tripId, owner.accessToken, 'sam@example.com');
    const stranger = await ctx.signIn('stranger@example.com');
    const { res } = await uploadAvatar(sam.accessToken);
    const version = res.json<Me>().avatarVersion;

    const seen = await call('GET', `/users/${sam.userId}/avatar`, owner.accessToken);
    expect(seen.statusCode).toBe(302);
    expect(seen.headers.location).toContain('storage.test/get/');
    expect((await call('GET', `/users/${sam.userId}/avatar`, sam.accessToken)).statusCode).toBe(302);
    expect((await call('GET', `/users/${sam.userId}/avatar`, stranger.accessToken)).statusCode).toBe(404);

    const trip = (await call('GET', `/trips/${tripId}`, owner.accessToken)).json<Trip>();
    expect(trip.members.find((m) => m.userId === sam.userId)).toMatchObject({ avatarVersion: version, avatarUrl: expect.stringContaining('avatars') });
    expect(trip.members.find((m) => m.userId !== sam.userId)).toMatchObject({ avatarUrl: null, avatarVersion: null });

    // Once Sam leaves, the owner no longer shares a trip with them.
    await call('DELETE', `/trips/${tripId}/members/${sam.userId}`, sam.accessToken);
    expect((await call('GET', `/users/${sam.userId}/avatar`, owner.accessToken)).statusCode).toBe(404);
  });
});
