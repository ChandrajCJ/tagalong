import type { ChatMessage, Poll } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

const setup = async () => {
  const owner = await ctx.signIn('owner@example.com');
  const tripId = await createTrip(ctx.app, owner.accessToken);
  const editor = await joinTrip(ctx, tripId, owner.accessToken, 'editor@example.com', 'editor');
  const viewer = await joinTrip(ctx, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
  return { owner, editor, viewer, tripId };
};

const ask = async (tripId: string, token: string, multi = false) => {
  const res = await ctx.app.inject({
    method: 'POST',
    url: `/trips/${tripId}/polls`,
    headers: bearer(token),
    payload: { question: 'Sintra on which day?', options: ['Friday', 'Saturday', 'Sunday'], multi },
  });
  expect(res.statusCode).toBe(201);
  return res.json<ChatMessage>();
};

const vote = (pollId: string, token: string, optionIds: string[]) =>
  ctx.app.inject({
    method: 'POST',
    url: `/polls/${pollId}/vote`,
    headers: bearer(token),
    payload: { optionIds },
  });

describe('polls in chat', () => {
  it('appears in the conversation with its options', async () => {
    const { owner, viewer, tripId } = await setup();
    const message = await ask(tripId, owner.accessToken);

    expect(message.kind).toBe('poll');
    expect(message.poll?.options.map((o) => o.label)).toEqual(['Friday', 'Saturday', 'Sunday']);
    expect(message.poll?.voterCount).toBe(0);

    const feed = await ctx.app.inject({
      method: 'GET',
      url: `/trips/${tripId}/messages`,
      headers: bearer(viewer.accessToken),
    });
    const seen = feed.json<{ messages: ChatMessage[] }>().messages.find((m) => m.kind === 'poll');
    expect(seen?.poll?.question).toBe('Sintra on which day?');
    expect(seen?.poll?.options[0]?.mine).toBe(false);
  });

  it('replaces the previous pick on a single-choice poll', async () => {
    const { owner, tripId } = await setup();
    const poll = (await ask(tripId, owner.accessToken)).poll!;
    const [friday, saturday] = poll.options;

    await vote(poll.id, owner.accessToken, [friday!.id]);
    const res = await vote(poll.id, owner.accessToken, [saturday!.id]);

    const after = res.json<Poll>();
    expect(after.options.find((o) => o.id === friday!.id)?.votes).toBe(0);
    expect(after.options.find((o) => o.id === saturday!.id)).toMatchObject({ votes: 1, mine: true });
    expect(after.voterCount).toBe(1);
  });

  it('keeps several picks on a multiple-choice poll', async () => {
    const { owner, tripId } = await setup();
    const poll = (await ask(tripId, owner.accessToken, true)).poll!;
    const ids = poll.options.slice(0, 2).map((o) => o.id);

    const res = await vote(poll.id, owner.accessToken, ids);
    const after = res.json<Poll>();
    expect(after.options.filter((o) => o.mine).map((o) => o.id)).toEqual(ids);
    expect(after.voterCount).toBe(1);
  });

  it('lets a viewer vote, and counts each person once', async () => {
    const { owner, editor, viewer, tripId } = await setup();
    const poll = (await ask(tripId, owner.accessToken)).poll!;
    const friday = poll.options[0]!.id;

    await vote(poll.id, editor.accessToken, [friday]);
    const res = await vote(poll.id, viewer.accessToken, [friday]);
    expect(res.statusCode).toBe(200);

    const after = res.json<Poll>();
    expect(after.options[0]).toMatchObject({ votes: 2, mine: true });
    expect(after.options[0]?.voters).toHaveLength(2);
    expect(after.voterCount).toBe(2);
  });

  it('clears a vote when no options are sent', async () => {
    const { owner, tripId } = await setup();
    const poll = (await ask(tripId, owner.accessToken)).poll!;

    await vote(poll.id, owner.accessToken, [poll.options[0]!.id]);
    const res = await vote(poll.id, owner.accessToken, []);
    expect(res.json<Poll>().voterCount).toBe(0);
  });

  it('rejects an option from another poll', async () => {
    const { owner, tripId } = await setup();
    const first = (await ask(tripId, owner.accessToken)).poll!;
    const second = (await ask(tripId, owner.accessToken)).poll!;

    const res = await vote(first.id, owner.accessToken, [second.options[0]!.id]);
    expect(res.statusCode).toBe(400);
  });

  it('stops voting once the poll is closed, and only the asker may close it', async () => {
    const { owner, editor, tripId } = await setup();
    const poll = (await ask(tripId, owner.accessToken)).poll!;

    const notYours = await ctx.app.inject({
      method: 'POST',
      url: `/polls/${poll.id}/close`,
      headers: bearer(editor.accessToken),
    });
    expect(notYours.statusCode).toBe(403);

    const closed = await ctx.app.inject({
      method: 'POST',
      url: `/polls/${poll.id}/close`,
      headers: bearer(owner.accessToken),
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json<Poll>().closedAt).not.toBeNull();

    const late = await vote(poll.id, editor.accessToken, [poll.options[0]!.id]);
    expect(late.statusCode).toBe(409);
  });

  it('hides a poll from someone who is not on the trip', async () => {
    const { owner, tripId } = await setup();
    const poll = (await ask(tripId, owner.accessToken)).poll!;
    const stranger = await ctx.signIn('stranger@example.com');

    const res = await vote(poll.id, stranger.accessToken, [poll.options[0]!.id]);
    expect(res.statusCode).toBe(404);
  });

  it('needs at least two options', async () => {
    const { owner, tripId } = await setup();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/polls`,
      headers: bearer(owner.accessToken),
      payload: { question: 'Beach?', options: ['Yes'] },
    });
    expect(res.statusCode).toBe(400);
  });
});
