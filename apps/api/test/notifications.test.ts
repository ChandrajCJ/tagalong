import type { NotificationPrefs, TripNotifications } from '@tagalong/shared';
import { MUTED_FOREVER } from '@tagalong/shared';
import { describe, expect, it } from 'vitest';
import { queueDueTomorrow } from '../src/jobs/due';
import { processActivity, processMention, processNotify, summarise, type PushMessage, type PushSender } from '../src/jobs/notify';
import type { Jobs } from '../src/lib/jobs';
import { activityKey, createNotifier } from '../src/lib/notifier';
import { onlineKey } from '../src/lib/presence';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

const recorder = () => {
  const sent: PushMessage[] = [];
  const push: PushSender = {
    async send(batch) {
      sent.push(...batch);
      return batch.map(() => ({ status: 'ok' as const }));
    },
  };
  return { push, sent };
};

describe('notifications you control', () => {
  const t = useTestApp();

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken, 'Goa');
    await t.app.inject({
      method: 'PATCH',
      url: `/trips/${tripId}`,
      headers: bearer(owner.accessToken),
      payload: { startDate: '2026-11-01', endDate: '2026-11-05', version: 1 },
    });
    const sam = await joinTrip(t, tripId, owner.accessToken, 'sam@example.com');
    await t.app.inject({
      method: 'POST',
      url: '/me/devices/push-token',
      headers: bearer(sam.accessToken),
      payload: { token: 'ExponentPushToken[sam]', platform: 'android' },
    });
    const ownerId = (await t.app.inject({ method: 'GET', url: '/me', headers: bearer(owner.accessToken) })).json<{ id: string }>().id;
    t.activity.length = 0;
    return { owner: { ...owner, userId: ownerId }, sam, tripId };
  };
  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
    t.app.inject({ method, url, headers: bearer(token), payload });
  const run = (kind: 'plan' | 'money' | 'todos' | 'trip', tripId: string, userId: string) => {
    const { push, sent } = recorder();
    return processActivity({ db: t.db, redis: t.redis, push }, { kind, tripId, userId }).then((result) => ({ result, sent }));
  };

  it('keeps defaults and per-trip overrides, with mute', async () => {
    const { sam, tripId } = await setup();
    const defaults = await call('PATCH', '/me/notifications', sam.accessToken, { plan: false, reminderMinutes: 60 });
    expect(defaults.json<NotificationPrefs>()).toMatchObject({ plan: false, chat: true, reminderMinutes: 60, mutedUntil: null });
    expect((await call('PATCH', '/me/notifications', sam.accessToken, { reminderMinutes: 45 })).statusCode).toBe(400);

    const trip = await call('PATCH', `/trips/${tripId}/notifications`, sam.accessToken, { plan: true, mutedUntil: MUTED_FOREVER });
    expect(trip.json<TripNotifications>()).toMatchObject({
      effective: { plan: true, mutedUntil: MUTED_FOREVER },
      overrides: { plan: true, chat: null, mutedUntil: MUTED_FOREVER },
    });
    // Back to the defaults.
    const reset = await call('PATCH', `/trips/${tripId}/notifications`, sam.accessToken, { plan: null, mutedUntil: null });
    expect(reset.json<TripNotifications>().effective).toMatchObject({ plan: false, mutedUntil: null });
  });

  it('tells others about plan changes, batched into one push that opens the day', async () => {
    const { owner, sam, tripId } = await setup();
    const add = (title: string) => call('POST', `/trips/${tripId}/items`, owner.accessToken, { title, date: '2026-11-02' });
    await add('Lunch');
    await add('Boat trip');
    expect(t.activity.filter((a) => a.userId === sam.userId)).toEqual([
      { kind: 'plan', tripId, userId: sam.userId },
      { kind: 'plan', tripId, userId: sam.userId },
    ]);
    // Never the person who made the change.
    expect(t.activity.some((a) => a.userId === owner.userId)).toBe(false);

    const { result, sent } = await run('plan', tripId, sam.userId);
    expect(result).toEqual({ sent: 1 });
    expect(sent[0]).toMatchObject({
      title: 'Goa',
      body: 'owner changed Day 2: 2 updates',
      data: { url: `/trips/${tripId}/plan?day=2026-11-02` },
      channelId: 'activity',
    });
    // The lines are used up.
    expect((await run('plan', tripId, sam.userId)).result).toEqual({ skipped: 'nothing' });
  });

  it('says when a stop moves day or goes, but not for small edits', async () => {
    const { owner, sam, tripId } = await setup();
    const item = (await call('POST', `/trips/${tripId}/items`, owner.accessToken, { title: 'Lunch', date: '2026-11-02' })).json<{
      id: string;
      version: number;
    }>();
    await t.redis.del(activityKey('plan', tripId, sam.userId));
    const renamed = await call('PATCH', `/items/${item.id}`, owner.accessToken, { title: 'Late lunch', version: item.version });
    expect((await run('plan', tripId, sam.userId)).result).toEqual({ skipped: 'nothing' });
    await call('PATCH', `/items/${item.id}`, owner.accessToken, { date: '2026-11-03', version: renamed.json<{ version: number }>().version });
    await call('DELETE', `/items/${item.id}`, owner.accessToken);
    const { sent } = await run('plan', tripId, sam.userId);
    // Moved to Day 3, then removed from it: both about the same day.
    expect(sent[0]?.body).toBe('owner changed Day 3: 2 updates');
  });

  it('respects what people turned off, mute and being in the app', async () => {
    const { owner, sam, tripId } = await setup();
    const add = () => call('POST', `/trips/${tripId}/items`, owner.accessToken, { title: 'Lunch', date: '2026-11-02' });

    await call('PATCH', '/me/notifications', sam.accessToken, { plan: false });
    await add();
    expect((await run('plan', tripId, sam.userId)).result).toEqual({ skipped: 'turned_off' });

    await call('PATCH', '/me/notifications', sam.accessToken, { plan: true });
    await call('PATCH', `/trips/${tripId}/notifications`, sam.accessToken, { mutedUntil: new Date(Date.now() + 86_400_000).toISOString() });
    await add();
    expect((await run('plan', tripId, sam.userId)).result).toEqual({ skipped: 'turned_off' });

    await call('PATCH', `/trips/${tripId}/notifications`, sam.accessToken, { mutedUntil: null });
    await t.redis.zadd(onlineKey(tripId), Date.now(), sam.userId);
    await add();
    expect((await run('plan', tripId, sam.userId)).result).toEqual({ skipped: 'online' });
    await t.redis.del(onlineKey(tripId));
  });

  it('lets @mentions through a mute, and stops chat when chat is off', async () => {
    const { owner, sam, tripId } = await setup();
    await call('PATCH', `/trips/${tripId}/notifications`, sam.accessToken, { mutedUntil: MUTED_FOREVER });
    const message = (
      await call('POST', `/trips/${tripId}/messages`, owner.accessToken, { body: '@sam hi', mentions: [sam.userId] })
    ).json<{ id: string }>();

    const { push, sent } = recorder();
    expect(await processMention({ db: t.db, redis: t.redis, push }, { tripId, messageId: message.id, userId: sam.userId })).toEqual({ sent: 1 });
    expect(sent[0]).toMatchObject({ body: 'owner mentioned you: @sam hi', channelId: 'mentions' });
    expect(await processNotify({ db: t.db, redis: t.redis, push }, { tripId, userId: sam.userId })).toEqual({ skipped: 'turned_off' });
  });

  it('tells you what an expense means for you, and when you’re paid', async () => {
    const { owner, sam, tripId } = await setup();
    await call('POST', `/trips/${tripId}/expenses`, owner.accessToken, {
      description: 'Dinner',
      currency: 'EUR',
      spentOn: '2026-11-02',
      category: 'food',
      paidBy: owner.userId,
      amountMinor: 3000,
      splits: [{ userId: owner.userId }, { userId: sam.userId }],
    });
    expect((await run('money', tripId, sam.userId)).sent[0]).toMatchObject({
      body: 'owner added Dinner, you owe €15',
      data: { url: `/trips/${tripId}/money` },
    });

    await call('POST', `/trips/${tripId}/settlements`, owner.accessToken, { fromUser: owner.userId, toUser: sam.userId, amountMinor: 500 });
    expect((await run('money', tripId, sam.userId)).sent[0]?.body).toBe('owner paid you €5');
  });

  it('tells you when a to-do is put on you, and the morning before it’s due', async () => {
    const { owner, sam, tripId } = await setup();
    await call('POST', `/trips/${tripId}/list-items`, owner.accessToken, {
      kind: 'todo',
      text: 'Book Sintra tickets',
      assigneeId: sam.userId,
      dueDate: '2026-10-21',
    });
    expect((await run('todos', tripId, sam.userId)).sent[0]?.body).toBe('owner gave you: Book Sintra tickets');

    const queued: { kind: string; userId: string }[] = [];
    const jobs = { notifyActivity: async (kind: string, _trip: string, ids: string[]) => void queued.push(...ids.map((userId) => ({ kind, userId }))) } as unknown as Jobs;
    const notifier = createNotifier(t.db, t.redis, jobs);
    // The trip has no time zone, so UTC: 08:00 is too early, 10:00 sends, and only once.
    expect(await queueDueTomorrow({ db: t.db, redis: t.redis, notifier }, new Date('2026-10-20T08:00:00Z'))).toEqual({ queued: 0 });
    expect(await queueDueTomorrow({ db: t.db, redis: t.redis, notifier }, new Date('2026-10-20T10:00:00Z'))).toEqual({ queued: 1 });
    expect(await queueDueTomorrow({ db: t.db, redis: t.redis, notifier }, new Date('2026-10-20T11:00:00Z'))).toEqual({ queued: 0 });
    expect(queued).toEqual([{ kind: 'todos', userId: sam.userId }]);
    expect((await run('todos', tripId, sam.userId)).sent[0]).toMatchObject({
      body: 'Due tomorrow: Book Sintra tickets',
      data: { url: `/trips/${tripId}/lists` },
    });
  });

  it('tells everyone when the trip is renamed or its dates change', async () => {
    const { owner, sam, tripId } = await setup();
    const trip = (await call('GET', `/trips/${tripId}`, owner.accessToken)).json<{ version: number }>();
    await call('PATCH', `/trips/${tripId}`, owner.accessToken, { coverColor: '#123456', version: trip.version });
    expect((await run('trip', tripId, sam.userId)).result).toEqual({ skipped: 'nothing' });
    await call('PATCH', `/trips/${tripId}`, owner.accessToken, { name: 'Goa 2026', version: trip.version + 1 });
    expect((await run('trip', tripId, sam.userId)).sent[0]?.body).toBe('owner renamed the trip “Goa 2026”');
  });

  it('sums up lines from several people', () => {
    expect(
      summarise('money', [
        { actorName: 'Sam', text: 'added A', url: '/' },
        { actorName: 'Priya', text: 'added B', url: '/' },
      ]),
    ).toBe('Sam and Priya: 2 money updates');
  });
});
