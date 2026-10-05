import { devices } from '@tagalong/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { processNotify, type PushMessage, type PushSender } from '../src/jobs/notify';
import { onlineKey } from '../src/lib/presence';
import { bearer, createTrip, joinTrip, useTestApp } from './helpers';

/** Records pushes instead of sending them. */
const recorder = (error?: string) => {
  const sent: PushMessage[] = [];
  const push: PushSender = {
    async send(batch) {
      sent.push(...batch);
      return batch.map(() => (error ? { status: 'error', details: { error } } : { status: 'ok' }));
    },
  };
  return { push, sent };
};

describe('chat push notifications', () => {
  const t = useTestApp();

  const setup = async () => {
    const owner = await t.signIn('owner@example.com');
    const tripId = await createTrip(t.app, owner.accessToken, 'Goa with the gang');
    const riya = await joinTrip(t, tripId, owner.accessToken, 'riya@example.com');
    const register = await t.app.inject({
      method: 'POST',
      url: '/me/devices/push-token',
      headers: bearer(riya.accessToken),
      payload: { token: 'ExponentPushToken[riya-phone]', platform: 'ios' },
    });
    expect(register.statusCode).toBe(204);
    const say = (body: string) =>
      t.app.inject({
        method: 'POST',
        url: `/trips/${tripId}/messages`,
        headers: bearer(owner.accessToken),
        payload: { body },
      });
    return { tripId, riya, say };
  };

  it('sends one summary for several unread messages', async () => {
    const { tripId, riya, say } = await setup();
    await say('Flights are booked');
    await say('Beach shack too');
    await say('Packing list soon');

    const { push, sent } = recorder();
    const result = await processNotify({ db: t.db, redis: t.redis, push }, { tripId, userId: riya.userId });
    expect(result).toEqual({ sent: 1 });
    expect(sent).toEqual([
      {
        to: 'ExponentPushToken[riya-phone]',
        title: 'Goa with the gang',
        body: 'owner: 3 new messages',
        data: { url: `/trips/${tripId}/chat` },
        sound: 'default',
      },
    ]);
  });

  it('shows the message itself when there is only one', async () => {
    const { tripId, riya, say } = await setup();
    await say('Flights are booked');
    const { push, sent } = recorder();
    await processNotify({ db: t.db, redis: t.redis, push }, { tripId, userId: riya.userId });
    expect(sent[0]?.body).toBe('owner: Flights are booked');
  });

  it("doesn't notify someone who's online or has already read it", async () => {
    const { tripId, riya, say } = await setup();
    const message = (await say('Flights are booked')).json();
    const { push, sent } = recorder();

    await t.redis.zadd(onlineKey(tripId), Date.now(), riya.userId);
    expect(await processNotify({ db: t.db, redis: t.redis, push }, { tripId, userId: riya.userId })).toEqual({
      skipped: 'online',
    });
    await t.redis.zrem(onlineKey(tripId), riya.userId);

    await t.app.inject({
      method: 'POST',
      url: `/trips/${tripId}/read`,
      headers: bearer(riya.accessToken),
      payload: { messageId: message.id },
    });
    expect(await processNotify({ db: t.db, redis: t.redis, push }, { tripId, userId: riya.userId })).toEqual({
      skipped: 'nothing_unread',
    });
    expect(sent).toHaveLength(0);
  });

  it('forgets a phone that uninstalled the app', async () => {
    const { tripId, riya, say } = await setup();
    await say('Flights are booked');
    const { push } = recorder('DeviceNotRegistered');
    await processNotify({ db: t.db, redis: t.redis, push }, { tripId, userId: riya.userId });

    const [device] = await t.db
      .select({ token: devices.pushToken })
      .from(devices)
      .where(eq(devices.userId, riya.userId));
    expect(device?.token).toBeNull();
  });
});
