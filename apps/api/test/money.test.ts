import type { ChatMessage, Expense, ItineraryItem, Settlement, TripEvent, TripMoney } from '@tagalong/shared';
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

const addExpense = (tripId: string, token: string, body: Record<string, unknown>) =>
  ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/expenses`,
    headers: bearer(token),
    payload: { description: 'Dinner', currency: 'EUR', spentOn: '2026-06-12', category: 'food', ...body },
  });

const money = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/money`, headers: bearer(token) });
  expect(res.statusCode).toBe(200);
  return res.json<TripMoney>();
};

const balanceOf = (m: TripMoney, userId: string) => m.balances.find((b) => b.userId === userId)?.netMinor;

const everyone = (...ids: string[]) => ids.map((userId) => ({ userId }));

describe('expenses', () => {
  it('splits a dinner three ways and shows everyone the same balances', async () => {
    const { tripId, alex, sam, priya } = await setup();
    const res = await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 9000,
      splits: everyone(alex.userId, sam.userId, priya.userId),
    });
    expect(res.statusCode).toBe(201);
    const expense = res.json<Expense>();
    expect(expense).toMatchObject({ baseAmountMinor: 9000, fxRate: 1, splitMethod: 'equal' });
    expect(expense.splits.map((s) => s.shareMinor)).toEqual([3000, 3000, 3000]);

    // Priya is a viewer, but sees it all.
    const m = await money(tripId, priya.accessToken);
    expect(m.expenses.map((e) => e.id)).toEqual([expense.id]);
    expect(balanceOf(m, alex.userId)).toBe(6000);
    expect(balanceOf(m, sam.userId)).toBe(-3000);
    expect(balanceOf(m, priya.userId)).toBe(-3000);
    expect(m.suggested).toHaveLength(2);
    expect(m.suggested.every((t) => t.toUser === alex.userId && t.amountMinor === 3000)).toBe(true);
  });

  it('posts a card in the chat when an expense is added', async () => {
    const { tripId, alex, sam } = await setup();
    await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 4550,
      description: 'Taxi to Sintra',
      splits: everyone(alex.userId, sam.userId),
    });
    const chat = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(sam.accessToken) });
    const cards = chat.json<{ messages: ChatMessage[] }>().messages.filter((m) => m.kind === 'system');
    expect(cards.map((c) => c.body)).toContain('alex added Taxi to Sintra · €45.50');
  });

  it('lets only editors add expenses, and hides the trip from strangers', async () => {
    const { tripId, alex, priya } = await setup();
    const asViewer = await addExpense(tripId, priya.accessToken, {
      paidBy: priya.userId,
      amountMinor: 1000,
      splits: everyone(priya.userId),
    });
    expect(asViewer.statusCode).toBe(403);

    const stranger = await ctx.signIn('stranger@example.com');
    expect((await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/money`, headers: bearer(stranger.accessToken) })).statusCode).toBe(404);
    const sneaky = await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 1000,
      splits: everyone(alex.userId, (await ctx.app.inject({ method: 'GET', url: '/me', headers: bearer(stranger.accessToken) })).json().id),
    });
    expect(sneaky.statusCode).toBe(400);
  });

  it('refuses a split that doesn’t add up', async () => {
    const { tripId, alex, sam } = await setup();
    const res = await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 1000,
      splitMethod: 'exact',
      splits: [
        { userId: alex.userId, value: 600 },
        { userId: sam.userId, value: 300 },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'bad_split' });
  });

  it('splits by shares, so a couple pays double', async () => {
    const { tripId, alex, sam } = await setup();
    const res = await addExpense(tripId, alex.accessToken, {
      paidBy: sam.userId,
      amountMinor: 12_000,
      splitMethod: 'shares',
      splits: [
        { userId: alex.userId, value: 2 },
        { userId: sam.userId, value: 1 },
      ],
    });
    const shares = Object.fromEntries(res.json<Expense>().splits.map((s) => [s.userId, s.shareMinor]));
    expect(shares).toEqual({ [alex.userId]: 8000, [sam.userId]: 4000 });
  });

  it('returns the same expense when the phone retries', async () => {
    const { tripId, alex, sam } = await setup();
    const body = {
      id: '01900000-0000-7000-8000-00000000e001',
      paidBy: alex.userId,
      amountMinor: 2000,
      splits: everyone(alex.userId, sam.userId),
    };
    expect((await addExpense(tripId, alex.accessToken, body)).statusCode).toBe(201);
    expect((await addExpense(tripId, alex.accessToken, body)).statusCode).toBe(200);
    expect((await money(tripId, alex.accessToken)).expenses).toHaveLength(1);
  });

  it('only links to plan items on the same trip', async () => {
    const { tripId, alex, sam } = await setup();
    const otherTrip = await createTrip(ctx.app, alex.accessToken, 'Porto');
    const elsewhere = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${otherTrip}/items`,
      headers: bearer(alex.accessToken),
      payload: { title: 'Port tasting' },
    });
    const res = await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 2000,
      splits: everyone(alex.userId, sam.userId),
      itemId: elsewhere.json<ItineraryItem>().id,
    });
    expect(res.statusCode).toBe(400);
  });

  it('tells everyone viewing the trip, straight away', async () => {
    const { tripId, alex, sam } = await setup();
    const listener = new Redis(loadEnv().REDIS_URL);
    const heard: TripEvent[] = [];
    await listener.subscribe(tripChannel(tripId));
    listener.on('message', (_c, raw) => heard.push(JSON.parse(raw)));

    const res = await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 2000,
      splits: everyone(alex.userId, sam.userId),
    });
    await new Promise((r) => setTimeout(r, 100));
    listener.disconnect();
    const event = heard.find((e) => e.type === 'expense.upserted');
    expect(event).toMatchObject({ entityId: res.json<Expense>().id, payload: { amountMinor: 2000 } });
  });
});

describe('editing and deleting expenses', () => {
  it('works the shares out again when the amount changes, and refuses a stale edit', async () => {
    const { tripId, alex, sam } = await setup();
    const expense = (
      await addExpense(tripId, alex.accessToken, {
        paidBy: alex.userId,
        amountMinor: 1000,
        splits: everyone(alex.userId, sam.userId),
      })
    ).json<Expense>();

    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: `/expenses/${expense.id}`,
      headers: bearer(sam.accessToken),
      payload: { version: expense.version, amountMinor: 3001 },
    });
    expect(edit.statusCode).toBe(200);
    const edited = edit.json<Expense>();
    expect(edited.splits.map((s) => s.shareMinor).sort()).toEqual([1500, 1501]);

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/expenses/${expense.id}`,
      headers: bearer(alex.accessToken),
      payload: { version: expense.version, description: 'Lunch' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toMatchObject({ amountMinor: 3001, version: edited.version });
  });

  it('drops a deleted expense out of the balances', async () => {
    const { tripId, alex, sam } = await setup();
    const expense = (
      await addExpense(tripId, alex.accessToken, {
        paidBy: alex.userId,
        amountMinor: 1000,
        splits: everyone(alex.userId, sam.userId),
      })
    ).json<Expense>();
    const del = await ctx.app.inject({ method: 'DELETE', url: `/expenses/${expense.id}`, headers: bearer(sam.accessToken) });
    expect(del.statusCode).toBe(204);
    const m = await money(tripId, alex.accessToken);
    expect(m.expenses).toEqual([]);
    expect(balanceOf(m, alex.userId)).toBe(0);
  });

  it('keeps someone who left in the money, and lets their old expenses be fixed', async () => {
    const { tripId, alex, sam } = await setup();
    const expense = (
      await addExpense(tripId, alex.accessToken, {
        paidBy: alex.userId,
        amountMinor: 1000,
        splits: everyone(alex.userId, sam.userId),
      })
    ).json<Expense>();
    await ctx.app.inject({ method: 'DELETE', url: `/trips/${tripId}/members/${sam.userId}`, headers: bearer(sam.accessToken) });

    const m = await money(tripId, alex.accessToken);
    expect(m.people.find((p) => p.userId === sam.userId)).toMatchObject({ active: false });
    expect(balanceOf(m, sam.userId)).toBe(-500);

    const fix = await ctx.app.inject({
      method: 'PATCH',
      url: `/expenses/${expense.id}`,
      headers: bearer(alex.accessToken),
      payload: { version: expense.version, amountMinor: 1200 },
    });
    expect(fix.statusCode).toBe(200);

    // But they can't be added to anything new.
    const fresh = await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 1000,
      splits: everyone(alex.userId, sam.userId),
    });
    expect(fresh.statusCode).toBe(400);
  });
});

describe('foreign currency', () => {
  it('converts at today’s rate and keeps that rate when the expense is edited later', async () => {
    const { tripId, alex, sam } = await setup();
    ctx.fx.set('USD:EUR', 0.9);
    const expense = (
      await addExpense(tripId, alex.accessToken, {
        paidBy: alex.userId,
        amountMinor: 10_000,
        currency: 'USD',
        splits: everyone(alex.userId, sam.userId),
      })
    ).json<Expense>();
    expect(expense).toMatchObject({ currency: 'USD', fxRate: 0.9, baseAmountMinor: 9000 });

    // The rate moves, but an edited description doesn't move the balances.
    ctx.fx.set('USD:EUR', 0.5);
    const edited = (
      await ctx.app.inject({
        method: 'PATCH',
        url: `/expenses/${expense.id}`,
        headers: bearer(alex.accessToken),
        payload: { version: expense.version, description: 'Uber' },
      })
    ).json<Expense>();
    expect(edited).toMatchObject({ fxRate: 0.9, baseAmountMinor: 9000 });

    // Giving a rate, say what the bank charged, uses it.
    const bank = (
      await ctx.app.inject({
        method: 'PATCH',
        url: `/expenses/${expense.id}`,
        headers: bearer(alex.accessToken),
        payload: { version: edited.version, fxRate: 0.95 },
      })
    ).json<Expense>();
    expect(bank).toMatchObject({ fxRate: 0.95, baseAmountMinor: 9500 });
  });

  it('asks for the rate when there isn’t a published one', async () => {
    const { tripId, alex, sam } = await setup();
    const body = { paidBy: alex.userId, amountMinor: 500_000, currency: 'VND', splits: everyone(alex.userId, sam.userId) };
    const missing = await addExpense(tripId, alex.accessToken, body);
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'rate_needed' });

    const given = await addExpense(tripId, alex.accessToken, { ...body, fxRate: 0.000036 });
    expect(given.statusCode).toBe(201);
    // VND has no cents: 500,000 ₫ is €18.
    expect(given.json<Expense>().baseAmountMinor).toBe(1800);
  });

  it('quotes a rate for the phone to show', async () => {
    const { alex } = await setup();
    ctx.fx.set('GBP:EUR', 1.15);
    const res = await ctx.app.inject({ method: 'GET', url: '/fx?from=gbp&to=EUR', headers: bearer(alex.accessToken) });
    expect(res.json()).toMatchObject({ from: 'GBP', to: 'EUR', rate: 1.15 });
    const none = await ctx.app.inject({ method: 'GET', url: '/fx?from=XYZ&to=EUR', headers: bearer(alex.accessToken) });
    expect(none.statusCode).toBe(404);
  });
});

describe('settling up', () => {
  const settle = (tripId: string, token: string, body: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: `/trips/${tripId}/settlements`, headers: bearer(token), payload: body });

  it('brings everyone back to zero once the suggested payments are made', async () => {
    const { tripId, alex, sam, priya } = await setup();
    await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 9000,
      splits: everyone(alex.userId, sam.userId, priya.userId),
    });
    await addExpense(tripId, sam.accessToken, {
      paidBy: sam.userId,
      amountMinor: 3000,
      splits: everyone(sam.userId, priya.userId),
    });

    const before = await money(tripId, priya.accessToken);
    for (const t of before.suggested) {
      const payer = [alex, sam, priya].find((p) => p.userId === t.fromUser)!;
      const res = await settle(tripId, payer.accessToken, { ...t, method: 'transfer' });
      expect(res.statusCode).toBe(201);
    }
    const after = await money(tripId, alex.accessToken);
    expect(after.balances.every((b) => b.netMinor === 0)).toBe(true);
    expect(after.suggested).toEqual([]);
    expect(after.settlements).toHaveLength(before.suggested.length);
  });

  it('lets a viewer record their own payment, but not other people’s', async () => {
    const { tripId, alex, sam, priya } = await setup();
    const own = await settle(tripId, priya.accessToken, { fromUser: priya.userId, toUser: alex.userId, amountMinor: 1000 });
    expect(own.statusCode).toBe(201);
    const others = await settle(tripId, priya.accessToken, { fromUser: sam.userId, toUser: alex.userId, amountMinor: 1000 });
    expect(others.statusCode).toBe(403);
  });

  it('refuses paying yourself', async () => {
    const { tripId, alex } = await setup();
    const res = await settle(tripId, alex.accessToken, { fromUser: alex.userId, toUser: alex.userId, amountMinor: 1000 });
    expect(res.statusCode).toBe(400);
  });

  it('undoes a payment recorded by mistake, and says so in the chat when made', async () => {
    const { tripId, alex, sam } = await setup();
    await addExpense(tripId, alex.accessToken, {
      paidBy: alex.userId,
      amountMinor: 1000,
      splits: everyone(alex.userId, sam.userId),
    });
    const payment = (
      await settle(tripId, sam.accessToken, { fromUser: sam.userId, toUser: alex.userId, amountMinor: 500 })
    ).json<Settlement>();
    expect(balanceOf(await money(tripId, alex.accessToken), sam.userId)).toBe(0);

    const chat = await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(alex.accessToken) });
    expect(chat.json<{ messages: ChatMessage[] }>().messages.map((m) => m.body)).toContain('sam paid alex €5');

    const undo = await ctx.app.inject({ method: 'DELETE', url: `/settlements/${payment.id}`, headers: bearer(sam.accessToken) });
    expect(undo.statusCode).toBe(204);
    expect(balanceOf(await money(tripId, alex.accessToken), sam.userId)).toBe(-500);
  });
});
