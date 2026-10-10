import type { ChatMessage, ItineraryItem, MessagePage, Poll } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const t = useTestApp();

const setup = async () => {
  const owner = await t.signIn('owner@example.com');
  const tripId = await createTrip(t.app, owner.accessToken);
  const viewer = await joinTrip(t, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
  const message = (
    await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/polls`,
      headers: bearer(owner.accessToken),
      payload: { question: 'Which beach on Saturday?', options: ['Baga', 'Palolem'] },
    })
  ).json<ChatMessage>();
  return { owner, viewer, tripId, poll: message.poll! };
};

const addToPlan = (token: string, poll: Poll, optionIndex: number, date: string | null = '2026-12-20') =>
  t.app.inject({
    method: 'POST',
    url: `/polls/${poll.id}/options/${poll.options[optionIndex]!.id}/plan`,
    headers: bearer(token),
    payload: { date },
  });

describe('adding a poll result to the plan', () => {
  it('turns the option into a plan item on the chosen day, and marks it', async () => {
    const { owner, tripId, poll } = await setup();
    const res = await addToPlan(owner.accessToken, poll, 0);
    expect(res.statusCode).toBe(200);
    const { poll: updated, item } = res.json<{ poll: Poll; item: ItineraryItem }>();
    expect(item).toMatchObject({ title: 'Baga', date: '2026-12-20' });
    expect(item.notes).toContain('Which beach on Saturday?');
    expect(updated.options[0]!.itemId).toBe(item.id);
    expect(updated.options[1]!.itemId).toBeNull();

    const plan = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/items`, headers: bearer(owner.accessToken) });
    expect(plan.json<{ items: ItineraryItem[] }>().items.map((i) => i.title)).toEqual(['Baga']);

    const chat = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(owner.accessToken) });
    expect(chat.json<MessagePage>().messages.map((m) => m.body)).toContain('owner added “Baga” to the plan, from the poll');
  });

  it('doesn’t add the same option twice, but can again once its item is deleted', async () => {
    const { owner, tripId, poll } = await setup();
    const first = (await addToPlan(owner.accessToken, poll, 0)).json<{ item: ItineraryItem }>();
    const again = (await addToPlan(owner.accessToken, poll, 0)).json<{ item: ItineraryItem }>();
    expect(again.item.id).toBe(first.item.id);

    await t.app.inject({ method: 'DELETE', url: `/items/${first.item.id}`, headers: bearer(owner.accessToken) });
    const list = await t.app.inject({ method: 'GET', url: `/trips/${tripId}/messages`, headers: bearer(owner.accessToken) });
    const shown = list.json<MessagePage>().messages.find((m) => m.poll)!.poll!;
    expect(shown.options[0]!.itemId).toBeNull();
    const readded = (await addToPlan(owner.accessToken, poll, 0)).json<{ item: ItineraryItem }>();
    expect(readded.item.id).not.toBe(first.item.id);
  });

  it('lets only editors add, and with no day if they like', async () => {
    const { owner, viewer, poll } = await setup();
    expect((await addToPlan(viewer.accessToken, poll, 0)).statusCode).toBe(403);
    const noDay = (await addToPlan(owner.accessToken, poll, 1, null)).json<{ item: ItineraryItem }>();
    expect(noDay.item.date).toBeNull();
  });

  it('refuses an option from a different poll', async () => {
    const { owner, tripId, poll } = await setup();
    const other = (
      await t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/polls`,
        headers: bearer(owner.accessToken),
        payload: { question: 'Dinner?', options: ['Fish', 'Curry'] },
      })
    ).json<ChatMessage>().poll!;
    const res = await t.app.inject({
      method: 'POST',
      url: `/polls/${poll.id}/options/${other.options[0]!.id}/plan`,
      headers: bearer(owner.accessToken),
      payload: { date: null },
    });
    expect(res.statusCode).toBe(404);
  });
});
