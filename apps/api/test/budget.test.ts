import type { Budget, ChatMessage, Expense, ItineraryItem, Trip, TripBudget, TripEvent, TripMoney } from '@tagalong/shared';
import { tripChannel } from '@tagalong/shared';
import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/env';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const setup = async () => {
  const owner = await ctx.signIn('alex@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const me = await ctx.app.inject({ method: 'GET', url: '/me', headers: bearer(owner.accessToken) });
  const alex = { ...owner, userId: me.json<{ id: string }>().id };
  const sam = await joinTrip(ctx, tripId, owner.accessToken, 'sam@example.com', 'editor');
  const priya = await joinTrip(ctx, tripId, owner.accessToken, 'priya@example.com', 'viewer');
  return { tripId, alex, sam, priya };
};

const putBudget = (tripId: string, token: string, body: Record<string, unknown>) =>
  ctx.app.inject({ method: 'PUT', url: `/trips/${tripId}/budget`, headers: bearer(token), payload: body });

const money = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/money`, headers: bearer(token) });
  expect(res.statusCode).toBe(200);
  return res.json<TripMoney>();
};

const status = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/budget`, headers: bearer(token) });
  expect(res.statusCode).toBe(200);
  return res.json<TripBudget>();
};

/** Alex pays for something shared by everyone given. */
const spend = async (tripId: string, token: string, paidBy: string, amountMinor: number, people: string[], extra = {}) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/expenses`,
    headers: bearer(token),
    payload: {
      description: 'Dinner',
      currency: 'EUR',
      spentOn: '2026-06-12',
      paidBy,
      amountMinor,
      splits: people.map((userId) => ({ userId })),
      ...extra,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Expense>();
};

const budgetCards = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(token) });
  return res
    .json<{ messages: ChatMessage[] }>()
    .messages.filter((m) => m.payload?.event === 'budget_alert')
    .map((m) => m.body)
    .reverse();
};

describe('a trip without a budget', () => {
  it('shows nothing about budgets, however much is spent', async () => {
    const { tripId, alex, sam } = await setup();
    const listener = new Redis(loadEnv().REDIS_URL);
    const heard: TripEvent[] = [];
    await listener.subscribe(tripChannel(tripId));
    listener.on('message', (_c, raw) => heard.push(JSON.parse(raw)));

    await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/items`,
      headers: bearer(alex.accessToken),
      payload: { title: 'Surf lesson', costEstimateMinor: 4000, costCurrency: 'EUR' },
    });
    await spend(tripId, alex.accessToken, alex.userId, 900_000, [alex.userId, sam.userId]);
    await new Promise((r) => setTimeout(r, 100));
    listener.disconnect();

    const m = await money(tripId, alex.accessToken);
    expect(m.budget).toBeNull();
    expect(m.planned).toEqual([]);
    expect(await status(tripId, alex.accessToken)).toEqual({ budget: null, spentMinor: 0, myShareMinor: 0 });
    expect(await budgetCards(tripId, alex.accessToken)).toEqual([]);
    expect(heard.some((e) => e.type === 'budget.updated')).toBe(false);
  });
});

describe('budget routes', () => {
  it('lets editors add, change and remove a budget, and everyone see it', async () => {
    const { tripId, alex, sam, priya } = await setup();
    const add = await putBudget(tripId, sam.accessToken, { mode: 'group', totalMinor: 250000, categories: { food: 80000 } });
    expect(add.statusCode).toBe(201);
    const budget = add.json<Budget>();
    expect(budget).toMatchObject({ tripId, mode: 'group', totalMinor: 250000, categories: { food: 80000 }, version: 1, updatedBy: sam.userId });

    // Priya is a viewer: she sees it but can't change it.
    expect((await money(tripId, priya.accessToken)).budget).toMatchObject({ totalMinor: 250000 });
    expect((await putBudget(tripId, priya.accessToken, { totalMinor: 1, version: 1 })).statusCode).toBe(403);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/budget`, headers: bearer(priya.accessToken) })).statusCode).toBe(403);

    const change = await putBudget(tripId, alex.accessToken, { mode: 'per_person', totalMinor: 90000, version: 1 });
    expect(change.statusCode).toBe(200);
    expect(change.json<Budget>()).toMatchObject({ mode: 'per_person', totalMinor: 90000, categories: {}, version: 2 });

    const removed = await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/budget`, headers: bearer(alex.accessToken) });
    expect(removed.statusCode).toBe(204);
    expect((await money(tripId, priya.accessToken)).budget).toBeNull();
  });

  it('refuses a stale change, and a second "add", with the current copy', async () => {
    const { tripId, alex, sam } = await setup();
    await putBudget(tripId, alex.accessToken, { totalMinor: 100000 });
    await putBudget(tripId, sam.accessToken, { totalMinor: 120000, version: 1 });

    const stale = await putBudget(tripId, alex.accessToken, { totalMinor: 90000, version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toMatchObject({ totalMinor: 120000, version: 2 });

    const again = await putBudget(tripId, alex.accessToken, { totalMinor: 90000 });
    expect(again.statusCode).toBe(409);
    expect(again.json().current).toMatchObject({ totalMinor: 120000 });
  });

  it('accepts categories without a total, but not an empty budget', async () => {
    const { tripId, alex } = await setup();
    expect((await putBudget(tripId, alex.accessToken, { categories: {} })).statusCode).toBe(400);
    const cats = await putBudget(tripId, alex.accessToken, { categories: { stay: 50000 } });
    expect(cats.statusCode).toBe(201);
    expect(cats.json<Budget>()).toMatchObject({ totalMinor: null, categories: { stay: 50000 } });
  });

  it('hides the budget from people not on the trip', async () => {
    const { tripId, alex } = await setup();
    await putBudget(tripId, alex.accessToken, { totalMinor: 100000 });
    const stranger = await ctx.signIn('stranger@example.com');
    expect((await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/budget`, headers: bearer(stranger.accessToken) })).statusCode).toBe(404);
  });

  it('tells everyone viewing the trip when the budget changes', async () => {
    const { tripId, alex } = await setup();
    const listener = new Redis(loadEnv().REDIS_URL);
    const heard: TripEvent[] = [];
    await listener.subscribe(tripChannel(tripId));
    listener.on('message', (_c, raw) => heard.push(JSON.parse(raw)));
    await putBudget(tripId, alex.accessToken, { totalMinor: 100000 });
    await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/budget`, headers: bearer(alex.accessToken) });
    await new Promise((r) => setTimeout(r, 100));
    listener.disconnect();
    const updates = heard.filter((e) => e.type === 'budget.updated');
    expect(updates.map((e) => (e.payload as Budget | null)?.totalMinor ?? null)).toEqual([100000, null]);
  });

  it('gives the Overview what was spent and my share', async () => {
    const { tripId, alex, sam } = await setup();
    await putBudget(tripId, alex.accessToken, { mode: 'per_person', totalMinor: 50000 });
    await spend(tripId, alex.accessToken, alex.userId, 9000, [alex.userId, sam.userId]);
    expect(await status(tripId, sam.accessToken)).toMatchObject({ spentMinor: 9000, myShareMinor: 4500, budget: { totalMinor: 50000 } });
  });
});

describe('budget on New trip and Edit trip', () => {
  it('creates a trip with or without a budget', async () => {
    const { accessToken } = await ctx.signIn('alex@example.com');
    const make = (body: Record<string, unknown>) =>
      ctx.app.inject({ method: 'POST', url: '/trips', headers: bearer(accessToken), payload: { name: 'Goa', destination: 'Goa', baseCurrency: 'INR', ...body } });
    const plain = (await make({})).json<Trip>();
    const budgeted = (await make({ budget: { mode: 'per_person', totalMinor: 1500000 } })).json<Trip>();
    expect((await money(plain.id, accessToken)).budget).toBeNull();
    expect((await money(budgeted.id, accessToken)).budget).toMatchObject({ mode: 'per_person', totalMinor: 1500000, categories: {} });
  });

  it('sets the total from Edit trip, keeps category limits, and removes it', async () => {
    const { tripId, alex } = await setup();
    await putBudget(tripId, alex.accessToken, { categories: { food: 20000 } });
    const edit = (budget: unknown, version: number) =>
      ctx.app.inject({ method: 'PATCH', url: `/trips/${tripId}`, headers: bearer(alex.accessToken), payload: { version, budget } });

    expect((await edit({ mode: 'group', totalMinor: 100000 }, 1)).statusCode).toBe(200);
    expect((await money(tripId, alex.accessToken)).budget).toMatchObject({ totalMinor: 100000, categories: { food: 20000 }, version: 2 });

    // Clearing the total keeps the category limits.
    await edit({ mode: 'group', totalMinor: null }, 2);
    expect((await money(tripId, alex.accessToken)).budget).toMatchObject({ totalMinor: null, categories: { food: 20000 } });

    await edit(null, 3);
    expect((await money(tripId, alex.accessToken)).budget).toBeNull();
  });
});

describe('budget alerts', () => {
  it('posts at 80% and 100% once each, and again after the budget is raised', async () => {
    const { tripId, alex, sam } = await setup();
    await putBudget(tripId, alex.accessToken, { totalMinor: 10000 });
    const both = [alex.userId, sam.userId];

    await spend(tripId, alex.accessToken, alex.userId, 7000, both);
    expect(await budgetCards(tripId, alex.accessToken)).toEqual([]);
    await spend(tripId, alex.accessToken, alex.userId, 1500, both);
    await spend(tripId, alex.accessToken, alex.userId, 100, both);
    expect(await budgetCards(tripId, alex.accessToken)).toEqual(['85% of the budget spent: €85 of €100']);

    await spend(tripId, sam.accessToken, sam.userId, 2000, both);
    await spend(tripId, sam.accessToken, sam.userId, 500, both);
    expect(await budgetCards(tripId, alex.accessToken)).toEqual([
      '85% of the budget spent: €85 of €100',
      'Budget reached: €106 of €100 spent',
    ]);

    // Raised past both marks: they fire again when spending gets there.
    const current = (await money(tripId, alex.accessToken)).budget!;
    await putBudget(tripId, alex.accessToken, { totalMinor: 20000, version: current.version });
    await spend(tripId, alex.accessToken, alex.userId, 6000, both);
    expect((await budgetCards(tripId, alex.accessToken)).at(-1)).toBe('85% of the budget spent: €171 of €200');
  });

  it('posts only "reached" when one expense jumps past both marks', async () => {
    const { tripId, alex, sam } = await setup();
    await putBudget(tripId, alex.accessToken, { mode: 'per_person', totalMinor: 1000 });
    // Three people at €10 each: €30 for the group.
    await spend(tripId, alex.accessToken, alex.userId, 4000, [alex.userId, sam.userId]);
    expect(await budgetCards(tripId, alex.accessToken)).toEqual(['Budget reached: €40 of €30 (€10 each) spent']);
  });

  it('starts over when the budget is removed and added again', async () => {
    const { tripId, alex } = await setup();
    await putBudget(tripId, alex.accessToken, { totalMinor: 1000 });
    await spend(tripId, alex.accessToken, alex.userId, 900, [alex.userId]);
    await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/budget`, headers: bearer(alex.accessToken) });
    await putBudget(tripId, alex.accessToken, { totalMinor: 1000 });
    expect(await budgetCards(tripId, alex.accessToken)).toEqual([
      '90% of the budget spent: €9 of €10',
      '90% of the budget spent: €9 of €10',
    ]);
  });
});

describe('planned costs', () => {
  it('counts plan estimates for everyone and booking prices, until they’re paid', async () => {
    const { tripId, alex, sam } = await setup();
    ctx.fx.set('USD:EUR', 0.9);
    await putBudget(tripId, alex.accessToken, { totalMinor: 500000 });
    const item = (
      await ctx.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/items`,
        headers: bearer(alex.accessToken),
        payload: { title: 'Surf lesson', type: 'activity', costEstimateMinor: 4000, costCurrency: 'EUR' },
      })
    ).json<ItineraryItem>();
    const hotel = (
      await ctx.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/items`,
        headers: bearer(alex.accessToken),
        payload: { title: 'Hotel', type: 'stay', costEstimateMinor: 10000, costCurrency: 'EUR' },
      })
    ).json<ItineraryItem>();
    // The booking's price stands in for the hotel's estimate.
    const booking = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/bookings`,
      headers: bearer(alex.accessToken),
      payload: { type: 'stay', itemId: hotel.id, costMinor: 20000, costCurrency: 'USD' },
    });
    expect(booking.statusCode).toBe(201);

    const before = await money(tripId, alex.accessToken);
    expect(before.planned.map((p) => [p.title, p.category, p.amountMinor]).sort()).toEqual([
      ['Hotel', 'stay', 18000],
      ['Surf lesson', 'activity', 12000],
    ]);

    await spend(tripId, alex.accessToken, alex.userId, 12000, [alex.userId, sam.userId], { itemId: item.id, category: 'activity' });
    expect((await money(tripId, alex.accessToken)).planned.map((p) => p.title)).toEqual(['Hotel']);
    // Paying for the hotel item covers the booking on it.
    await spend(tripId, alex.accessToken, alex.userId, 18000, [alex.userId, sam.userId], { itemId: hotel.id, category: 'stay' });
    expect((await money(tripId, alex.accessToken)).planned).toEqual([]);
  });

  it('only links an expense to a booking on the same trip', async () => {
    const { tripId, alex, sam } = await setup();
    const otherTrip = await createTrip(ctx.app, alex.accessToken, 'Porto');
    const elsewhere = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${otherTrip}/bookings`,
      headers: bearer(alex.accessToken),
      payload: { type: 'stay', costMinor: 5000, costCurrency: 'EUR' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/expenses`,
      headers: bearer(alex.accessToken),
      payload: {
        description: 'Hotel',
        currency: 'EUR',
        spentOn: '2026-06-12',
        paidBy: alex.userId,
        amountMinor: 5000,
        splits: [{ userId: alex.userId }, { userId: sam.userId }],
        bookingId: elsewhere.json<{ id: string }>().id,
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
