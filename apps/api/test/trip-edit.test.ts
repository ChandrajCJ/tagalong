import type { Trip } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const patch = (token: string, tripId: string, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'PATCH', url: `/trips/${tripId}`, headers: bearer(token), payload });

const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const trip = (await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}`, headers: bearer(owner.accessToken) })).json<Trip>();
  return { owner, tripId, trip };
};

describe('editing a trip', () => {
  it('adds dates later, so the plan can go day by day', async () => {
    const { owner, tripId, trip } = await setup();
    const res = await patch(owner.accessToken, tripId, { version: trip.version, startDate: '2026-12-20', endDate: '2026-12-24', name: 'Goa at Christmas' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Trip>()).toMatchObject({ startDate: '2026-12-20', endDate: '2026-12-24', name: 'Goa at Christmas', version: trip.version + 1 });
  });

  it('lets editors edit, but not viewers', async () => {
    const { owner, tripId, trip } = await setup();
    const editor = await joinTrip(ctx, tripId, owner.accessToken, 'ed@example.com', 'editor');
    const viewer = await joinTrip(ctx, tripId, owner.accessToken, 'vi@example.com', 'viewer');
    expect((await patch(viewer.accessToken, tripId, { version: trip.version, name: 'Nope' })).statusCode).toBe(403);
    expect((await patch(editor.accessToken, tripId, { version: trip.version, name: 'Yes' })).statusCode).toBe(200);
  });

  it('refuses an end before the start, even when only one date changes', async () => {
    const { owner, tripId, trip } = await setup();
    const first = (await patch(owner.accessToken, tripId, { version: trip.version, startDate: '2026-12-20', endDate: '2026-12-24' })).json<Trip>();
    expect((await patch(owner.accessToken, tripId, { version: first.version, endDate: '2026-12-10' })).statusCode).toBe(400);
  });

  it('refuses a stale edit with the latest copy', async () => {
    const { owner, tripId, trip } = await setup();
    await patch(owner.accessToken, tripId, { version: trip.version, name: 'First' });
    const stale = await patch(owner.accessToken, tripId, { version: trip.version, name: 'Second' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toMatchObject({ name: 'First' });
  });

  it('changes the currency only while there are no expenses', async () => {
    const { owner, tripId, trip } = await setup();
    const inr = (await patch(owner.accessToken, tripId, { version: trip.version, baseCurrency: 'inr' })).json<Trip>();
    expect(inr.baseCurrency).toBe('INR');
    const me = (await ctx.app.inject({ method: 'GET', url: '/me', headers: bearer(owner.accessToken) })).json<{ id: string }>();
    await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/expenses`,
      headers: bearer(owner.accessToken),
      payload: { paidBy: me.id, description: 'Taxi', amountMinor: 50000, currency: 'INR', spentOn: '2026-12-20', splits: [{ userId: me.id }] },
    });
    const locked = await patch(owner.accessToken, tripId, { version: inr.version, baseCurrency: 'EUR' });
    expect(locked.statusCode).toBe(400);
    expect(locked.json()).toMatchObject({ error: 'currency_locked' });
  });
});
