import { and, desc, eq, gt, isNotNull, isNull, ne } from 'drizzle-orm';
import {
  channels,
  devices,
  messages,
  readStates,
  tripMembers,
  trips,
  users,
  type Db,
} from '@tagalong/db';
import type { Redis } from 'ioredis';
import type { NotifyJob } from '../lib/jobs';
import { ONLINE_WINDOW_MS, onlineKey } from '../lib/presence';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { url: string };
  sound: 'default';
}

/** One result per message, in the same order (Expo calls these tickets). */
export interface PushTicket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

/** Sends through Expo's push service, which forwards to Apple and Google. */
export const expoPushSender: PushSender = {
  async send(batch) {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Expo push failed: ${res.status}`);
    const json = (await res.json()) as { data?: PushTicket[] };
    return json.data ?? [];
  },
};

export type NotifyResult =
  | { skipped: 'online' | 'not_member' | 'nothing_unread' | 'no_device' }
  | { sent: number };

const preview = (text: string) => (text.length > 120 ? `${text.slice(0, 117)}…` : text);

/** "Priya", "Priya and Sam", "Priya, Sam and Alex". */
const joinNames = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

/**
 * Runs about 20 seconds after the first unread message for one person.
 * Sends one summary push for everything they haven't read, unless they're
 * looking at the app right now.
 */
export const processNotify = async (
  deps: { db: Db; redis: Redis; push: PushSender },
  { tripId, userId }: NotifyJob,
): Promise<NotifyResult> => {
  const { db, redis, push } = deps;

  const lastSeen = await redis.zscore(onlineKey(tripId), userId);
  if (lastSeen && Date.now() - Number(lastSeen) < ONLINE_WINDOW_MS) return { skipped: 'online' };

  const [membership] = await db
    .select({ tripName: trips.name })
    .from(tripMembers)
    .innerJoin(trips, eq(trips.id, tripMembers.tripId))
    .where(
      and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId), isNull(tripMembers.leftAt)),
    );
  if (!membership) return { skipped: 'not_member' };

  const [channel] = await db
    .select({ id: channels.id })
    .from(channels)
    .where(and(eq(channels.tripId, tripId), eq(channels.kind, 'trip')));
  if (!channel) return { skipped: 'nothing_unread' };

  const [read] = await db
    .select({ at: readStates.lastReadAt })
    .from(readStates)
    .where(and(eq(readStates.channelId, channel.id), eq(readStates.userId, userId)));

  const unread = await db
    .select({ body: messages.body, sender: users.displayName })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(
      and(
        eq(messages.channelId, channel.id),
        eq(messages.kind, 'text'),
        isNull(messages.deletedAt),
        ne(messages.senderId, userId),
        read ? gt(messages.createdAt, read.at) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(50);
  if (unread.length === 0) return { skipped: 'nothing_unread' };

  const tokens = await db
    .select({ id: devices.id, token: devices.pushToken })
    .from(devices)
    .where(and(eq(devices.userId, userId), isNotNull(devices.pushToken)));
  if (tokens.length === 0) return { skipped: 'no_device' };

  const senders = [...new Set(unread.map((m) => m.sender))];
  const body =
    unread.length === 1
      ? `${unread[0]!.sender}: ${preview(unread[0]!.body)}`
      : `${joinNames(senders.slice(0, 3))}${senders.length > 3 ? ' and others' : ''}: ${unread.length} new messages`;

  const tickets = await push.send(
    tokens.map((t) => ({
      to: t.token!,
      title: membership.tripName,
      body,
      data: { url: `/trips/${tripId}/chat` },
      sound: 'default',
    })),
  );

  // Phones that uninstalled the app: stop sending to them.
  await Promise.all(
    tickets.map((ticket, i) =>
      ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
        ? db.update(devices).set({ pushToken: null }).where(eq(devices.id, tokens[i]!.id))
        : null,
    ),
  );
  return { sent: tokens.length };
};
