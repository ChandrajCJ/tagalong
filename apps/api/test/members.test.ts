import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('trip members', () => {
  const t = useTestApp();

  const setRole = (token: string, tripId: string, userId: string, role: string) =>
    t.app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}/members/${userId}`,
      headers: bearer(token),
      payload: { role },
    });
  const remove = (token: string, tripId: string, userId: string) =>
    t.app.inject({ method: 'DELETE', url: `/trips/${tripId}/members/${userId}`, headers: bearer(token) });
  const myId = async (token: string) =>
    (await t.app.inject({ method: 'GET', url: '/me', headers: bearer(token) })).json().id as string;

  it('lets the owner change roles, but not other members', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    const priya = await joinTrip(t, tripId, owner.accessToken, 'priya@example.com');

    const byOwner = await setRole(owner.accessToken, tripId, sam.userId, 'viewer');
    expect(byOwner.statusCode).toBe(200);
    expect(byOwner.json().members.find((m: { userId: string }) => m.userId === sam.userId).role).toBe(
      'viewer',
    );

    const byEditor = await setRole(priya.accessToken, tripId, sam.userId, 'editor');
    expect(byEditor.statusCode).toBe(403);
  });

  it('never leaves a trip without an owner', async () => {
    const owner = await t.signIn('owner@example.com');
    const ownerId = await myId(owner.accessToken);
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');

    expect((await remove(owner.accessToken, tripId, ownerId)).statusCode).toBe(409);
    expect((await setRole(owner.accessToken, tripId, ownerId, 'editor')).statusCode).toBe(409);

    // With a second owner, the first one can step down.
    expect((await setRole(owner.accessToken, tripId, sam.userId, 'owner')).statusCode).toBe(200);
    expect((await remove(owner.accessToken, tripId, ownerId)).statusCode).toBe(204);
  });

  it('lets members leave, which hides the trip from them', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');

    expect((await remove(sam.accessToken, tripId, sam.userId)).statusCode).toBe(204);
    const list = await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(sam.accessToken) });
    expect(list.json().trips).toHaveLength(0);
    const get = await t.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(sam.accessToken) });
    expect(get.statusCode).toBe(404);
  });

  it("stops non-owners removing other people", async () => {
    const owner = await t.signIn('owner@example.com');
    const ownerId = await myId(owner.accessToken);
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');

    expect((await remove(sam.accessToken, tripId, ownerId)).statusCode).toBe(403);
  });

  it('lets someone who left rejoin with a new invite', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    await remove(owner.accessToken, tripId, sam.userId);

    const again = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com', 'viewer');
    const trip = await t.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(again.accessToken) });
    expect(trip.statusCode).toBe(200);
    expect(trip.json()).toMatchObject({ myRole: 'viewer', memberCount: 2 });
  });

  it("stops someone the owner removed using a link that was already going round", async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);

    // A link shared with the group before anything happened.
    const invite = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/invites`,
      headers: bearer(owner.accessToken),
      payload: { role: 'editor' },
    });
    const token = invite.json<{ token: string }>().token;

    const sam = await t.signIn('sam@example.com');
    await t.app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: bearer(sam.accessToken) });
    const samId = await myId(sam.accessToken);
    await remove(owner.accessToken, tripId, samId);

    const preview = await t.app.inject({ method: 'GET', url: `/invites/${token}`, headers: bearer(sam.accessToken) });
    expect(preview.statusCode).toBe(404);

    const again = await t.app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: bearer(sam.accessToken) });
    expect(again.statusCode).toBe(404);
  });

  it('still lets someone who left on their own come back with the same link', async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const invite = await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/invites`,
      headers: bearer(owner.accessToken),
      payload: { role: 'editor' },
    });
    const token = invite.json<{ token: string }>().token;

    const sam = await t.signIn('sam@example.com');
    const accept = () =>
      t.app.inject({ method: 'POST', url: `/invites/${token}/accept`, headers: bearer(sam.accessToken) });
    await accept();
    const samId = await myId(sam.accessToken);
    await remove(sam.accessToken, tripId, samId); // leaving, not removed

    expect((await accept()).statusCode).toBe(200);
  });
});
