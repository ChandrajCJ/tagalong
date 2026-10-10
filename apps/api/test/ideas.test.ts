import type { Idea, ItineraryItem } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

/** An owner with a trip, plus an editor and a viewer who joined it. */
const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const editor = await joinTrip(ctx, tripId, owner.accessToken, 'editor@example.com', 'editor');
  const viewer = await joinTrip(ctx, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
  return { owner, editor, viewer, tripId };
};

const addIdea = async (tripId: string, token: string, title = 'Sintra day trip') => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/ideas`,
    headers: bearer(token),
    payload: { title, note: 'Takes a whole day', type: 'activity' },
  });
  expect(res.statusCode).toBe(201);
  return res.json<Idea>();
};

const listIdeas = async (tripId: string, token: string) => {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/trips/${tripId}/ideas`,
    headers: bearer(token),
  });
  expect(res.statusCode).toBe(200);
  return res.json<{ ideas: Idea[] }>().ideas;
};

describe('ideas', () => {
  it('adds an idea and lists it for everyone on the trip', async () => {
    const { owner, viewer, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);

    expect(idea.title).toBe('Sintra day trip');
    expect(idea.ups).toBe(0);
    expect(idea.myVote).toBeNull();

    const seen = await listIdeas(tripId, viewer.accessToken);
    expect(seen.map((i) => i.id)).toEqual([idea.id]);
  });

  it('returns the same idea when a create is retried with the same id', async () => {
    const { owner, tripId } = await setup();
    const payload = { id: crypto.randomUUID(), title: 'Tram 28' };
    const first = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/ideas`,
      headers: bearer(owner.accessToken),
      payload,
    });
    const second = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/ideas`,
      headers: bearer(owner.accessToken),
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json<Idea>().id).toBe(payload.id);
    expect(await listIdeas(tripId, owner.accessToken)).toHaveLength(1);
  });

  it('lets a viewer vote but not add an idea', async () => {
    const { owner, viewer, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);

    const blocked = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/ideas`,
      headers: bearer(viewer.accessToken),
      payload: { title: 'Belém' },
    });
    expect(blocked.statusCode).toBe(403);

    const voted = await ctx.app.inject({
      method: 'PUT',
      url: `/ideas/${idea.id}/vote`,
      headers: bearer(viewer.accessToken),
      payload: { value: 'up' },
    });
    expect(voted.statusCode).toBe(200);
    expect(voted.json<Idea>().ups).toBe(1);
    expect(voted.json<Idea>().myVote).toBe('up');
  });

  it('replaces a vote instead of adding another, and clears it on delete', async () => {
    const { owner, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);
    const vote = (value: string) =>
      ctx.app.inject({
        method: 'PUT',
        url: `/ideas/${idea.id}/vote`,
        headers: bearer(owner.accessToken),
        payload: { value },
      });

    await vote('up');
    const changed = await vote('down');
    expect(changed.json<Idea>()).toMatchObject({ ups: 0, downs: 1, myVote: 'down' });

    const cleared = await ctx.app.inject({
      method: 'DELETE',
      url: `/ideas/${idea.id}/vote`,
      headers: bearer(owner.accessToken),
    });
    expect(cleared.json<Idea>()).toMatchObject({ ups: 0, downs: 0, myVote: null });
    expect(cleared.json<Idea>().voters).toHaveLength(0);
  });

  it('sorts the board by support', async () => {
    const { owner, editor, tripId } = await setup();
    const quiet = await addIdea(tripId, owner.accessToken, 'Quiet beach');
    const popular = await addIdea(tripId, owner.accessToken, 'Sunset boat');

    for (const token of [owner.accessToken, editor.accessToken]) {
      await ctx.app.inject({
        method: 'PUT',
        url: `/ideas/${popular.id}/vote`,
        headers: bearer(token),
        payload: { value: 'up' },
      });
    }

    const ideas = await listIdeas(tripId, owner.accessToken);
    expect(ideas.map((i) => i.id)).toEqual([popular.id, quiet.id]);
    expect(ideas[0]!.voters).toHaveLength(2);
  });

  it('answers 409 with the latest copy when the version is stale', async () => {
    const { owner, editor, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);

    const first = await ctx.app.inject({
      method: 'PATCH',
      url: `/ideas/${idea.id}`,
      headers: bearer(editor.accessToken),
      payload: { title: 'Sintra, early start', version: idea.version },
    });
    expect(first.statusCode).toBe(200);

    const stale = await ctx.app.inject({
      method: 'PATCH',
      url: `/ideas/${idea.id}`,
      headers: bearer(owner.accessToken),
      payload: { title: 'Sintra, late start', version: idea.version },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json<{ current: Idea }>().current.title).toBe('Sintra, early start');
  });

  it('hides a deleted idea', async () => {
    const { owner, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/ideas/${idea.id}`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode).toBe(204);
    expect(await listIdeas(tripId, owner.accessToken)).toHaveLength(0);
  });

  it('hides the whole board from someone who is not on the trip', async () => {
    const { tripId } = await setup();
    const stranger = await ctx.signIn('stranger@example.com');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/ideas`,
      headers: bearer(stranger.accessToken),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('promoting an idea', () => {
  it('creates a plan item, marks the idea, and posts an activity card', async () => {
    const { owner, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/ideas/${idea.id}/promote`,
      headers: bearer(owner.accessToken),
      payload: { date: '2026-05-04' },
    });
    expect(res.statusCode).toBe(200);
    const { item, idea: promoted } = res.json<{ item: ItineraryItem; idea: Idea }>();

    expect(item).toMatchObject({ title: 'Sintra day trip', date: '2026-05-04', type: 'activity' });
    expect(promoted.promotedItemId).toBe(item.id);

    const items = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/items`,
      headers: bearer(owner.accessToken),
    });
    expect(items.json<{ items: ItineraryItem[] }>().items.map((i) => i.id)).toContain(item.id);

    const messages = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages`,
      headers: bearer(owner.accessToken),
    });
    const card = messages
      .json<{ messages: { kind: string; body: string }[] }>()
      .messages.find((m) => m.body.includes('into the plan'));
    expect(card?.kind).toBe('system');
  });

  it('is safe to promote twice: the same item comes back', async () => {
    const { owner, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);
    const promote = () =>
      ctx.app.inject({
        method: 'POST',
        url: `/ideas/${idea.id}/promote`,
        headers: bearer(owner.accessToken),
        payload: { date: null },
      });

    const first = await promote();
    const second = await promote();
    expect(second.json<{ item: ItineraryItem }>().item.id).toBe(
      first.json<{ item: ItineraryItem }>().item.id,
    );

    const items = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/items`,
      headers: bearer(owner.accessToken),
    });
    expect(items.json<{ items: ItineraryItem[] }>().items).toHaveLength(1);
  });

  it("doesn't let a viewer promote", async () => {
    const { owner, viewer, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/ideas/${idea.id}/promote`,
      headers: bearer(viewer.accessToken),
      payload: { date: null },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('taking an idea back out of the plan', () => {
  const promote = (ideaId: string, token: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/ideas/${ideaId}/promote`,
      headers: bearer(token),
      payload: { date: '2027-06-13' },
    });
  const planTitles = async (tripId: string, token: string) =>
    (
      await ctx.app.inject({ method: 'GET', url: `/trips/${tripId}/items`, headers: bearer(token) })
    )
      .json<{ items: ItineraryItem[] }>()
      .items.map((i) => i.title);

  it('removes the plan item and puts the idea back on the board, votes intact', async () => {
    const { owner, editor, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);
    await ctx.app.inject({
      method: 'PUT',
      url: `/ideas/${idea.id}/vote`,
      headers: bearer(editor.accessToken),
      payload: { value: 'up' },
    });
    await promote(idea.id, owner.accessToken);
    expect(await planTitles(tripId, owner.accessToken)).toEqual(['Sintra day trip']);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/ideas/${idea.id}/unpromote`,
      headers: bearer(owner.accessToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<Idea>()).toMatchObject({ promotedItemId: null, ups: 1 });
    expect(await planTitles(tripId, owner.accessToken)).toEqual([]);

    // And it can go back in again.
    expect((await promote(idea.id, owner.accessToken)).statusCode).toBe(200);
    expect(await planTitles(tripId, owner.accessToken)).toEqual(['Sintra day trip']);
  });

  it("frees the idea when its plan item is deleted from the plan directly", async () => {
    const { owner, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);
    const { item } = (await promote(idea.id, owner.accessToken)).json<{ item: ItineraryItem }>();

    await ctx.app.inject({ method: 'DELETE', url: `/items/${item.id}`, headers: bearer(owner.accessToken) });

    const [listed] = await listIdeas(tripId, owner.accessToken);
    expect(listed?.promotedItemId).toBeNull();
  });

  it("doesn't let a viewer take an idea out of the plan", async () => {
    const { owner, viewer, tripId } = await setup();
    const idea = await addIdea(tripId, owner.accessToken);
    await promote(idea.id, owner.accessToken);
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/ideas/${idea.id}/unpromote`,
      headers: bearer(viewer.accessToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
