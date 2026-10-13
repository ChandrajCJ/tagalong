import type { ItineraryItem, ListItem, ListsOverview, TripEvent, TripList } from '@tagalong/shared';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

describe('checklists', () => {
  const t = useTestApp();

  let listener: Redis;
  const events: TripEvent[] = [];
  beforeAll(async () => {
    listener = new Redis(process.env.REDIS_URL!);
    await listener.psubscribe('trip:*');
    listener.on('pmessage', (_p, _c, raw) => events.push(JSON.parse(raw)));
  });
  afterAll(() => listener.disconnect());
  /** Lets earlier events arrive, then forgets them. */
  const quiet = async () => {
    await new Promise((r) => setTimeout(r, 100));
    events.length = 0;
  };
  const heard = async (type: TripEvent['type']) => {
    await new Promise((r) => setTimeout(r, 100));
    return events.filter((e) => e.type === type);
  };

  /** An owner with a trip, plus an editor and a viewer who joined it. */
  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken);
    const editor = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com', 'editor');
    const viewer = await joinTrip(t, tripId, owner.accessToken, 'viewer@example.com', 'viewer');
    const me = await t.app.inject({ method: 'GET', url: '/me', headers: bearer(owner.accessToken) });
    return { owner: { ...owner, userId: me.json<{ id: string }>().id }, editor, viewer, tripId };
  };

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
    t.app.inject({ method, url, headers: bearer(token), payload });
  const addLine = async (token: string, tripId: string, payload: object) => {
    const res = await call('POST', `/trips/${tripId}/list-items`, token, payload);
    expect(res.statusCode).toBe(201);
    return res.json<{ item: ListItem; list: TripList | null }>();
  };
  const overview = async (token: string, tripId: string) => {
    const res = await call('GET', `/trips/${tripId}/lists`, token);
    expect(res.statusCode).toBe(200);
    return res.json<ListsOverview>();
  };

  it('makes the packing list on the first line, and puts later lines on it', async () => {
    const { owner, editor, viewer, tripId } = await setup();
    await quiet();
    const first = await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'Passport', scope: 'everyone' });
    expect(first.list).toMatchObject({ kind: 'packing', title: 'Packing' });
    const second = await addLine(editor.accessToken, tripId, { kind: 'packing', text: 'First-aid kit' });
    expect(second.list).toBeNull();
    expect(second.item.listId).toBe(first.list!.id);

    const seen = await overview(viewer.accessToken, tripId);
    expect(seen.lists).toHaveLength(1);
    expect(seen.items.map((i) => i.text)).toEqual(['Passport', 'First-aid kit']);
    expect((await heard('list.upserted')).map((e) => e.entityId)).toEqual([first.list!.id]);
    expect(await heard('list_item.upserted')).toHaveLength(2);
  });

  it('returns the same line when a create is retried with the same id', async () => {
    const { owner, tripId } = await setup();
    const payload = { id: crypto.randomUUID(), kind: 'todo', text: 'Book Sintra tickets' };
    const first = await call('POST', `/trips/${tripId}/list-items`, owner.accessToken, payload);
    const again = await call('POST', `/trips/${tripId}/list-items`, owner.accessToken, payload);
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(200);
    expect(again.json<{ item: ListItem }>().item.id).toBe(payload.id);
    expect((await overview(owner.accessToken, tripId)).items).toHaveLength(1);

    const listId = crypto.randomUUID();
    const a = await call('POST', `/trips/${tripId}/lists`, owner.accessToken, { id: listId, title: 'Beach bag', kind: 'packing' });
    const b = await call('POST', `/trips/${tripId}/lists`, owner.accessToken, { id: listId, title: 'Beach bag', kind: 'packing' });
    expect([a.statusCode, b.statusCode]).toEqual([201, 200]);
  });

  it('edits with a version check, and answers a stale one with the current copy', async () => {
    const { owner, editor, tripId } = await setup();
    const { item } = await addLine(owner.accessToken, tripId, { kind: 'todo', text: 'Book tickets' });

    const ok = await call('PATCH', `/list-items/${item.id}`, editor.accessToken, {
      version: item.version,
      text: 'Book Sintra tickets',
      assigneeId: editor.userId,
      dueDate: '2027-06-01',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json<ListItem>()).toMatchObject({ version: 2, assigneeId: editor.userId, dueDate: '2027-06-01' });

    const stale = await call('PATCH', `/list-items/${item.id}`, owner.accessToken, { version: 1, text: 'Book train' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toMatchObject({ text: 'Book Sintra tickets', version: 2 });

    const listId = item.listId;
    const renamed = await call('PATCH', `/lists/${listId}`, owner.accessToken, { version: 1, title: 'Before we go' });
    expect(renamed.json<TripList>().title).toBe('Before we go');
    const staleList = await call('PATCH', `/lists/${listId}`, owner.accessToken, { version: 1, title: 'Nope' });
    expect(staleList.statusCode).toBe(409);
    expect(staleList.json().current.title).toBe('Before we go');
  });

  it('only lets an assignee be someone on the trip, and a link be a plan item in it', async () => {
    const { owner, tripId } = await setup();
    const stranger = await t.signIn('stranger@example.com');
    const strangerId = (await call('GET', '/me', stranger.accessToken)).json<{ id: string }>().id;
    const bad = await call('POST', `/trips/${tripId}/list-items`, owner.accessToken, {
      kind: 'todo',
      text: 'Pack',
      assigneeId: strangerId,
    });
    expect(bad.statusCode).toBe(400);

    const otherTrip = await createTrip(t.app, owner.accessToken, 'Goa');
    const elsewhere = await call('POST', `/trips/${otherTrip}/items`, owner.accessToken, { title: 'Beach' });
    const badLink = await call('POST', `/trips/${tripId}/list-items`, owner.accessToken, {
      kind: 'todo',
      text: 'Book it',
      itemId: elsewhere.json<ItineraryItem>().id,
    });
    expect(badLink.statusCode).toBe(400);

    const here = await call('POST', `/trips/${tripId}/items`, owner.accessToken, { title: 'Sintra' });
    const linked = await addLine(owner.accessToken, tripId, { kind: 'todo', text: 'Book it', itemId: here.json<ItineraryItem>().id });
    expect(linked.item.itemId).toBe(here.json<ItineraryItem>().id);
  });

  it('stops viewers adding or editing, but lets them tick their own packing', async () => {
    const { owner, viewer, tripId } = await setup();
    const passport = (await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'Passport', scope: 'everyone' })).item;
    const kit = (await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'First-aid kit' })).item;

    expect((await call('POST', `/trips/${tripId}/list-items`, viewer.accessToken, { kind: 'packing', text: 'Hat' })).statusCode).toBe(403);
    expect((await call('POST', `/trips/${tripId}/lists`, viewer.accessToken, { kind: 'packing', title: 'Mine' })).statusCode).toBe(403);
    expect((await call('PATCH', `/list-items/${passport.id}`, viewer.accessToken, { version: 1, text: 'ID' })).statusCode).toBe(403);
    expect((await call('DELETE', `/list-items/${passport.id}`, viewer.accessToken)).statusCode).toBe(403);
    expect((await call('POST', `/list-items/${kit.id}/done`, viewer.accessToken)).statusCode).toBe(403);

    const ticked = await call('POST', `/list-items/${passport.id}/check`, viewer.accessToken);
    expect(ticked.statusCode).toBe(200);
    expect(ticked.json<ListItem>().checkedBy).toEqual([viewer.userId]);
    // Ticking doesn't change the version, so it can't make an edit conflict.
    expect(ticked.json<ListItem>().version).toBe(1);

    const untick = await call('DELETE', `/list-items/${passport.id}/check`, viewer.accessToken);
    expect(untick.json<ListItem>().checkedBy).toEqual([]);
  });

  it('counts each person’s tick on an everyone line, and only people still on the trip', async () => {
    const { owner, editor, viewer, tripId } = await setup();
    const passport = (await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'Passport', scope: 'everyone' })).item;
    for (const who of [owner, editor, viewer]) {
      await call('POST', `/list-items/${passport.id}/check`, who.accessToken);
    }
    // Twice is the same as once.
    await call('POST', `/list-items/${passport.id}/check`, owner.accessToken);
    let line = (await overview(owner.accessToken, tripId)).items[0]!;
    expect(line.checkedBy.sort()).toEqual([owner.userId, editor.userId, viewer.userId].sort());

    const removed = await call('DELETE', `/trips/${tripId}/members/${editor.userId}`, owner.accessToken);
    expect(removed.statusCode).toBe(204);
    line = (await overview(owner.accessToken, tripId)).items[0]!;
    expect(line.checkedBy.sort()).toEqual([owner.userId, viewer.userId].sort());

    // A shared line has no per-person tick, and an everyone line no group tick.
    const kit = (await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'First-aid kit' })).item;
    expect((await call('POST', `/list-items/${kit.id}/check`, owner.accessToken)).statusCode).toBe(400);
    expect((await call('POST', `/list-items/${passport.id}/done`, owner.accessToken)).statusCode).toBe(400);
  });

  it('ticks a shared line once for the group', async () => {
    const { owner, editor, tripId } = await setup();
    const kit = (await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'First-aid kit', assigneeId: editor.userId })).item;
    await quiet();

    const done = await call('POST', `/list-items/${kit.id}/done`, editor.accessToken);
    expect(done.json<ListItem>()).toMatchObject({ doneBy: editor.userId, version: 1 });
    expect(done.json<ListItem>().doneAt).not.toBeNull();
    const again = await call('POST', `/list-items/${kit.id}/done`, owner.accessToken);
    expect(again.json<ListItem>().doneBy).toBe(editor.userId);

    const undone = await call('DELETE', `/list-items/${kit.id}/done`, owner.accessToken);
    expect(undone.json<ListItem>()).toMatchObject({ doneBy: null, doneAt: null });

    const published = await heard('list_item.upserted');
    expect(published).toHaveLength(3);
    expect(published.at(-1)).toMatchObject({ tripId, entityId: kit.id, payload: { doneAt: null } });
  });

  it('deletes a line, and a whole list with its lines', async () => {
    const { owner, tripId } = await setup();
    const { item, list } = await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'Hat' });
    await addLine(owner.accessToken, tripId, { kind: 'packing', text: 'Scarf' });
    await quiet();

    expect((await call('DELETE', `/list-items/${item.id}`, owner.accessToken)).statusCode).toBe(204);
    expect((await overview(owner.accessToken, tripId)).items.map((i) => i.text)).toEqual(['Scarf']);
    expect((await heard('list_item.deleted')).map((e) => e.entityId)).toEqual([item.id]);

    expect((await call('DELETE', `/lists/${list!.id}`, owner.accessToken)).statusCode).toBe(204);
    const after = await overview(owner.accessToken, tripId);
    expect(after).toEqual({ lists: [], items: [] });
    expect((await heard('list.deleted')).map((e) => e.entityId)).toEqual([list!.id]);

    const log = await t.db.execute<{ entity: string; op: string }>(
      sql`select entity, op from sync.change_log where trip_id = ${tripId} and op = 'delete' order by seq`,
    );
    expect(log.map((r) => `${r.entity}:${r.op}`)).toEqual(['list_item:delete', 'list:delete', 'list_item:delete']);
  });

  it('keeps lists private to the trip', async () => {
    const { tripId } = await setup();
    const stranger = await t.signIn('stranger@example.com');
    expect((await call('GET', `/trips/${tripId}/lists`, stranger.accessToken)).statusCode).toBe(404);
  });
});
