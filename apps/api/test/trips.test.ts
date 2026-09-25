import { newId } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, useTestApp } from './helpers';

const lisbon = {
  name: 'Lisbon with the crew',
  destination: 'Lisbon, Portugal',
  startDate: '2027-06-12',
  endDate: '2027-06-16',
};

describe('trips', () => {
  const t = useTestApp();

  it('creates a trip, makes the creator owner and lists it', async () => {
    const { accessToken } = await t.signIn('owner@example.com');

    const created = await t.app.inject({
      method: 'POST',
      url: '/trips',
      headers: bearer(accessToken),
      payload: lisbon,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ ...lisbon, myRole: 'owner', memberCount: 1 });

    const list = await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(accessToken) });
    expect(list.json().trips).toHaveLength(1);
  });

  it('treats a retry with the same client id as the same trip', async () => {
    const { accessToken } = await t.signIn('owner@example.com');
    const payload = { ...lisbon, id: newId() };
    const send = () =>
      t.app.inject({ method: 'POST', url: '/trips', headers: bearer(accessToken), payload });

    expect((await send()).statusCode).toBe(201);
    expect((await send()).statusCode).toBe(200);
    const list = await t.app.inject({ method: 'GET', url: '/trips', headers: bearer(accessToken) });
    expect(list.json().trips).toHaveLength(1);
  });

  it('rejects an end date before the start date', async () => {
    const { accessToken } = await t.signIn('owner@example.com');
    const res = await t.app.inject({
      method: 'POST',
      url: '/trips',
      headers: bearer(accessToken),
      payload: { ...lisbon, startDate: '2027-06-16', endDate: '2027-06-12' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('hides a trip from people who are not members', async () => {
    const owner = await t.signIn('owner@example.com');
    const stranger = await t.signIn('stranger@example.com');
    const trip = await t.app.inject({
      method: 'POST',
      url: '/trips',
      headers: bearer(owner.accessToken),
      payload: lisbon,
    });

    const res = await t.app.inject({
      method: 'GET',
      url: `/trips/${trip.json().id}`,
      headers: bearer(stranger.accessToken),
    });
    expect(res.statusCode).toBe(404);

    const list = await t.app.inject({
      method: 'GET',
      url: '/trips',
      headers: bearer(stranger.accessToken),
    });
    expect(list.json().trips).toHaveLength(0);
  });

  it('requires sign-in', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/trips' });
    expect(res.statusCode).toBe(401);
  });
});
