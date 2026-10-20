import { describe, expect, it } from 'vitest';
import { queueCountdowns, type WeatherLookup } from '../src/jobs/countdown';
import type { PushMessage, PushSender } from '../src/jobs/notify';
import type { MyTrips } from '@tagalong/shared';
import { bearer, joinTrip, useTestApp } from './helpers';

const ctx = useTestApp();

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

const call = (method: 'POST' | 'PATCH', url: string, token: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: bearer(token), payload });

/** Priya, on India time, with a Goa trip starting 1 November and a phone that takes pushes. */
const setup = async (timezone: string | undefined = 'Asia/Kolkata') => {
  const me = await ctx.signIn('priya@example.com');
  await call('POST', '/me/devices/push-token', me.accessToken, { token: 'ExponentPushToken[priya]', platform: 'android', timezone });
  const tripId = (
    await call('POST', '/trips', me.accessToken, {
      name: 'Goa',
      destination: 'Goa, India',
      startDate: '2026-11-01',
      endDate: '2026-11-05',
      location: { placeId: 'osm:R:1', latitude: 15.3, longitude: 74.1, bounds: null, countryCode: 'IN' },
    })
  ).json<{ id: string }>().id;
  const todo = () => call('POST', `/trips/${tripId}/list-items`, me.accessToken, { kind: 'todo', text: 'Book the airport taxi' });
  const pack = (text: string) => call('POST', `/trips/${tripId}/list-items`, me.accessToken, { kind: 'packing', text, scope: 'everyone' });
  return { me, tripId, todo, pack };
};

/** 09:10 in India (UTC+5:30) on 25 October: a week before 1 November. */
const WEEK_BEFORE_9AM = new Date('2026-10-25T03:40:00Z');
const noWeather: WeatherLookup = async () => null;

describe('getting ready on the trips list', () => {
  it('counts my own ticks on everyone’s lines and open shared to-dos', async () => {
    const { me, tripId, todo, pack } = await setup();
    const sam = await joinTrip(ctx, tripId, me.accessToken, 'sam@example.com');
    const passport = (await pack('Passport')).json<{ item: { id: string } }>().item;
    await pack('Swimwear');
    await todo();
    await call('POST', `/list-items/${passport.id}/check`, me.accessToken);
    const mine = (await ctx.app.inject({ method: 'GET', url: '/trips', headers: bearer(me.accessToken) })).json<MyTrips>();
    expect(mine.trips[0]!.readiness).toEqual({ packed: 1, packingTotal: 2, todosOpen: 1 });
    // Sam's list is his own: my tick isn't his.
    const his = (await ctx.app.inject({ method: 'GET', url: '/trips', headers: bearer(sam.accessToken) })).json<MyTrips>();
    expect(his.trips[0]!.readiness).toEqual({ packed: 0, packingTotal: 2, todosOpen: 1 });
  });
});

describe('countdown pushes', () => {
  it('sends a week out, from 9 am on the person’s own clock, once', async () => {
    const { tripId, todo } = await setup();
    await todo();
    const { push, sent } = recorder();
    // 08:30 in India: not yet.
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, new Date('2026-10-25T03:00:00Z'))).toEqual({ sent: 0 });
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, WEEK_BEFORE_9AM)).toEqual({ sent: 1 });
    expect(sent).toEqual([
      {
        to: 'ExponentPushToken[priya]',
        title: 'Goa',
        body: 'A week to Goa! 1 to-do still open.',
        data: { url: `/trips/${tripId}/lists` },
        sound: 'default',
        channelId: 'activity',
      },
    ]);
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, new Date('2026-10-25T09:00:00Z'))).toEqual({ sent: 0 });
  });

  it('skips the week-out push while nothing is open, and sends it once something is', async () => {
    const { todo } = await setup();
    const { push, sent } = recorder();
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, WEEK_BEFORE_9AM)).toEqual({ sent: 0 });
    await todo();
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, new Date('2026-10-25T05:00:00Z'))).toEqual({ sent: 1 });
    expect(sent[0]!.body).toBe('A week to Goa! 1 to-do still open.');
  });

  it('counts what’s left to pack three days out, and gives the weather the evening before', async () => {
    const { pack } = await setup();
    await pack('Passport');
    await pack('Swimwear');
    const { push, sent } = recorder();
    // 29 October, 09:30 in India.
    await queueCountdowns({ db: ctx.db, push, weather: noWeather }, new Date('2026-10-29T04:00:00Z'));
    expect(sent.at(-1)!.body).toBe('3 days to go · 2 items to pack.');
    const asked: string[] = [];
    const weather: WeatherLookup = async (centre, date) => {
      asked.push(`${centre.latitude},${centre.longitude}:${date}`);
      return { maxC: 31, minC: 24, rainChance: 70 };
    };
    // 31 October, 18:30 in India is too early; 19:30 is the evening before.
    expect(await queueCountdowns({ db: ctx.db, push, weather }, new Date('2026-10-31T13:00:00Z'))).toEqual({ sent: 0 });
    await queueCountdowns({ db: ctx.db, push, weather }, new Date('2026-10-31T14:00:00Z'));
    expect(sent.at(-1)!.body).toBe('Tomorrow: Goa · weather 31°/24°, rain likely · 2 items to pack');
    expect(asked).toEqual(['15.3,74.1:2026-11-01']);
  });

  it('names the first thing on the day, the morning of', async () => {
    const { me, tripId } = await setup();
    await call('POST', `/trips/${tripId}/items`, me.accessToken, { title: 'Beach shack lunch', date: '2026-11-01', startTime: '13:00' });
    await call('POST', `/trips/${tripId}/bookings`, me.accessToken, {
      type: 'flight',
      provider: 'IndiGo',
      startsAt: '2026-11-01T05:10:00Z',
      timezone: 'Asia/Kolkata',
      details: { flightNumber: '6E 2134', from: 'BOM', to: 'GOI' },
    });
    const { push, sent } = recorder();
    // 1 November, 08:05 in India.
    await queueCountdowns({ db: ctx.db, push, weather: noWeather }, new Date('2026-11-01T02:35:00Z'));
    expect(sent).toEqual([expect.objectContaining({ body: 'Today’s the day! First up: Flight BOM → GOI at 10:40.', data: { url: `/trips/${tripId}` } })]);
  });

  it('uses the trip’s clock when the phone never said its own', async () => {
    const { todo } = await setup(undefined);
    await todo();
    const { push } = recorder();
    // The trip's time zone is the fake map service's answer: India.
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, WEEK_BEFORE_9AM)).toEqual({ sent: 1 });
  });

  it('respects turning countdowns off, and muting the trip', async () => {
    const { me, tripId, todo } = await setup();
    await todo();
    const { push } = recorder();
    await call('PATCH', `/trips/${tripId}/notifications`, me.accessToken, { mutedUntil: '2027-01-01T00:00:00Z' });
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, WEEK_BEFORE_9AM)).toEqual({ sent: 0 });
    await call('PATCH', `/trips/${tripId}/notifications`, me.accessToken, { mutedUntil: null });
    await call('PATCH', '/me/notifications', me.accessToken, { countdown: false });
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, WEEK_BEFORE_9AM)).toEqual({ sent: 0 });
    await call('PATCH', '/me/notifications', me.accessToken, { countdown: true });
    expect(await queueCountdowns({ db: ctx.db, push, weather: noWeather }, WEEK_BEFORE_9AM)).toEqual({ sent: 1 });
  });
});
