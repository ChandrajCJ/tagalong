import { invites } from '@tagalong/db';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, useTestApp } from './helpers';

describe('invites', () => {
  const t = useTestApp();

  const makeInvite = async (token: string, tripId: string, payload: object = {}) =>
    t.app.inject({ method: 'POST', url: `/trips/${tripId}/invites`, headers: bearer(token), payload });

  it('lets a friend preview and join a trip through a link', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const invite = await makeInvite(owner.accessToken, tripId, { role: 'editor' });
    expect(invite.statusCode).toBe(201);
    const { token } = invite.json();
    expect(token).toBeTruthy();

    const friend = await t.signIn('friend@example.com');
    const preview = await t.app.inject({
      method: 'GET',
      url: `/invites/${token}`,
      headers: bearer(friend.accessToken),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      tripId,
      tripName: 'Lisbon',
      inviterName: 'owner',
      memberCount: 1,
      role: 'editor',
      alreadyMember: false,
    });

    const joined = await t.app.inject({
      method: 'POST',
      url: `/invites/${token}/accept`,
      headers: bearer(friend.accessToken),
    });
    expect(joined.statusCode).toBe(200);
    expect(joined.json()).toMatchObject({ id: tripId, myRole: 'editor', memberCount: 2 });

    const list = await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(friend.accessToken) });
    expect(list.json().trips).toHaveLength(1);
  });

  it('treats accepting twice as a no-op', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const { token } = (await makeInvite(owner.accessToken, tripId)).json();
    const friend = await t.signIn('friend@example.com');
    const accept = () =>
      t.app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: bearer(friend.accessToken) });

    await accept();
    const second = await accept();
    expect(second.statusCode).toBe(200);
    expect(second.json().memberCount).toBe(2);

    const [row] = await t.db.select({ useCount: invites.useCount }).from(invites);
    expect(row?.useCount).toBe(1);
  });

  it('rejects expired, revoked, used-up and unknown links with the same message', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const friend = await t.signIn('friend@example.com');
    const preview = (token: string) =>
      t.app.inject({ method: 'GET', url: `/invites/${token}`, headers: bearer(friend.accessToken) });

    const expired = (await makeInvite(owner.accessToken, tripId)).json();
    await t.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) });

    const revoked = (await makeInvite(owner.accessToken, tripId)).json();
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/trips/${tripId}/invites/${revoked.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(del.statusCode).toBe(204);

    const single = (await makeInvite(owner.accessToken, tripId, { maxUses: 1 })).json();
    const other = await t.signIn('other@example.com');
    await t.app.inject({
      method: 'POST',
      url: `/invites/${single.token}/accept`,
      headers: bearer(other.accessToken),
    });

    const results = await Promise.all(
      [expired.token, revoked.token, single.token, 'x'.repeat(43)].map(preview),
    );
    const messages = new Set(results.map((r) => r.json().message));
    expect(results.map((r) => r.statusCode)).toEqual([404, 404, 404, 404]);
    expect(messages.size).toBe(1);
  });

  it("doesn't let viewers invite or anyone grant owner through a link", async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);

    const asOwner = await makeInvite(owner.accessToken, tripId, { role: 'owner' });
    expect(asOwner.statusCode).toBe(400);

    const { token } = (await makeInvite(owner.accessToken, tripId, { role: 'viewer' })).json();
    const viewer = await t.signIn('viewer@example.com');
    await t.app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: bearer(viewer.accessToken) });

    const byViewer = await makeInvite(viewer.accessToken, tripId);
    expect(byViewer.statusCode).toBe(403);
  });

  it('only shows active links to owners, and never their tokens', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    await makeInvite(owner.accessToken, tripId);

    const list = await t.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/invites`,
      headers: bearer(owner.accessToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().invites).toHaveLength(1);
    expect(list.json().invites[0].token).toBeUndefined();

    const stranger = await t.signIn('stranger@example.com');
    const hidden = await t.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/invites`,
      headers: bearer(stranger.accessToken),
    });
    expect(hidden.statusCode).toBe(404);
  });
});
