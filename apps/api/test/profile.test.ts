import type { Me, Trip } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const patchMe = (token: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'PATCH', url: '/me', headers: bearer(token), payload });

describe('your profile', () => {
  it('changes your name and UPI ID, which people on your trips can see', async () => {
    const owner = await ctx.signIn('priya@example.com');
    const tripId = await createTrip(ctx.app, owner.accessToken);
    const sam = await joinTrip(ctx, tripId, owner.accessToken, 'sam@example.com');

    const res = await patchMe(owner.accessToken, { displayName: 'Priya S', upiId: ' Priya.S@OKAXIS ' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Me>()).toMatchObject({ displayName: 'Priya S', upiId: 'priya.s@okaxis' });

    const trip = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(sam.accessToken) });
    const priya = trip.json<Trip>().members.find((m) => m.displayName === 'Priya S');
    expect(priya?.upiId).toBe('priya.s@okaxis');
  });

  it('removes a UPI ID, and refuses one that isn’t real', async () => {
    const me = await ctx.signIn('priya@example.com');
    await patchMe(me.accessToken, { upiId: 'priya@okaxis' });
    expect((await patchMe(me.accessToken, { upiId: null })).json<Me>().upiId).toBeNull();
    expect((await patchMe(me.accessToken, { upiId: 'not a upi id' })).statusCode).toBe(400);
    expect((await patchMe(me.accessToken, { displayName: '  ' })).statusCode).toBe(400);
    expect((await patchMe(me.accessToken, {})).statusCode).toBe(400);
  });

  it('needs you to be signed in', async () => {
    const res = await ctx.app.inject({ method: 'PATCH', url: '/me', payload: { displayName: 'X' } });
    expect(res.statusCode).toBe(401);
  });
});
