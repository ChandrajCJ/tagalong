import websocket from '@fastify/websocket';
import { users, type Db } from '@tagalong/db';
import {
  ClientMessage,
  newId,
  Presence,
  TripEvent,
  tripChannel,
  type ServerMessage,
} from '@tagalong/shared';
import { eq } from 'drizzle-orm';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import type { Env } from '../env';
import { requireTripRole } from '../lib/access';
import { authPlugin, type AccessClaims } from '../plugins/auth';

const HEARTBEAT_MS = 25_000;
const PRESENCE_PREFIX = 'presence:';
/** Sorted set of who's online per trip (score = last seen). Week 4's push reads it. */
export const onlineKey = (tripId: string) => `online:${tripId}`;

interface Conn {
  id: string;
  socket: WebSocket;
  userId: string;
  displayName: string;
  trips: Set<string>;
  editing: Map<string, string | null>;
  alive: boolean;
}

interface GatewayDeps {
  env: Env;
  db: Db;
  /** For commands (publish, presence sets). */
  redis: Redis;
  /** A separate connection: a subscribed Redis client can't run other commands. */
  subscriber: Redis;
}

const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * The realtime gateway: keeps a WebSocket open to each phone and forwards
 * trip events from Redis to everyone subscribed to that trip.
 */
export const buildGateway = async ({ env, db, redis, subscriber }: GatewayDeps) => {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
  });
  await app.register(authPlugin, { secret: env.JWT_SECRET });
  await app.register(websocket);

  const rooms = new Map<string, Set<Conn>>();

  const send = (conn: Conn, message: ServerMessage) => {
    if (conn.socket.readyState === conn.socket.OPEN) conn.socket.send(JSON.stringify(message));
  };

  const join = async (conn: Conn, tripId: string) => {
    let room = rooms.get(tripId);
    if (!room) rooms.set(tripId, (room = new Set()));
    room.add(conn);
    conn.trips.add(tripId);
    await redis.zadd(onlineKey(tripId), Date.now(), conn.userId);
  };

  const leave = async (conn: Conn, tripId: string) => {
    const room = rooms.get(tripId);
    room?.delete(conn);
    if (room?.size === 0) rooms.delete(tripId);
    conn.trips.delete(tripId);
    if (conn.editing.get(tripId)) {
      await publishPresence(conn, tripId, null);
    }
    conn.editing.delete(tripId);
    const stillHere = [...(rooms.get(tripId) ?? [])].some((c) => c.userId === conn.userId);
    if (!stillHere) await redis.zrem(onlineKey(tripId), conn.userId);
  };

  const publishPresence = (conn: Conn, tripId: string, itemId: string | null) => {
    const presence: Presence = { tripId, userId: conn.userId, displayName: conn.displayName, itemId };
    return redis.publish(
      `${PRESENCE_PREFIX}${tripId}`,
      JSON.stringify({ presence, originClientId: conn.id }),
    );
  };

  // Every gateway instance hears every event and delivers to its own sockets.
  await subscriber.psubscribe(tripChannel('*'), `${PRESENCE_PREFIX}*`);
  subscriber.on('pmessage', (_pattern, channel, raw) => {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (channel.startsWith(PRESENCE_PREFIX)) {
      const parsed = Presence.safeParse((data as { presence?: unknown }).presence);
      if (!parsed.success) return;
      const origin = (data as { originClientId?: string }).originClientId;
      for (const conn of rooms.get(parsed.data.tripId) ?? []) {
        if (conn.id !== origin) send(conn, { kind: 'presence', presence: parsed.data });
      }
      return;
    }

    const parsed = TripEvent.safeParse(data);
    if (!parsed.success) return;
    const event = parsed.data;
    const room = [...(rooms.get(event.tripId) ?? [])];
    for (const conn of room) {
      if (conn.id !== event.originClientId) send(conn, { kind: 'event', event });
    }

    // Someone left or was removed: stop sending them this trip.
    if (event.type === 'member.left') {
      const leftUser = (event.payload as { userId?: string } | undefined)?.userId;
      for (const conn of room.filter((c) => c.userId === leftUser)) {
        void leave(conn, event.tripId);
        send(conn, {
          kind: 'error',
          code: 'removed',
          message: "You're no longer on this trip",
          tripId: event.tripId,
        });
      }
    }
  });

  // Phones that vanish without closing (tunnels, airplane mode) get cleaned up.
  const conns = new Set<Conn>();
  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.socket.terminate();
        continue;
      }
      conn.alive = false;
      conn.socket.ping();
    }
  }, HEARTBEAT_MS);

  app.addHook('onClose', async () => {
    clearInterval(heartbeat);
    await subscriber.punsubscribe();
  });

  app.get('/health', async () => ({ status: 'ok', connections: conns.size }));

  app.get<{ Querystring: { token?: string; clientId?: string } }>(
    '/ws',
    { websocket: true },
    (socket, request) => {
      // Listen right away: the phone may send "subscribe" before setup finishes,
      // so messages wait for `ready` instead of being lost.
      const ready = (async (): Promise<Conn | null> => {
        let claims: AccessClaims;
        try {
          claims = app.jwt.verify<AccessClaims>(request.query.token ?? '');
        } catch {
          socket.close(4401, 'unauthorized');
          return null;
        }
        const [user] = await db
          .select({ displayName: users.displayName })
          .from(users)
          .where(eq(users.id, claims.sub));
        if (!user) {
          socket.close(4401, 'unauthorized');
          return null;
        }
        const requested = request.query.clientId;
        const conn: Conn = {
          id: requested && CLIENT_ID.test(requested) ? requested : newId(),
          socket,
          userId: claims.sub,
          displayName: user.displayName,
          trips: new Set(),
          editing: new Map(),
          alive: true,
        };
        conns.add(conn);
        send(conn, { kind: 'ready', clientId: conn.id });
        return conn;
      })();

      socket.on('pong', async () => {
        const conn = await ready;
        if (!conn) return;
        conn.alive = true;
        for (const tripId of conn.trips) void redis.zadd(onlineKey(tripId), Date.now(), conn.userId);
      });

      socket.on('close', async () => {
        const conn = await ready;
        if (!conn) return;
        conns.delete(conn);
        for (const tripId of [...conn.trips]) void leave(conn, tripId);
      });

      socket.on('message', async (raw) => {
        const conn = await ready;
        if (!conn) return;
        let message: ClientMessage;
        try {
          message = ClientMessage.parse(JSON.parse(raw.toString()));
        } catch {
          send(conn, { kind: 'error', code: 'bad_message', message: 'Unrecognized message' });
          return;
        }

        if (message.op === 'subscribe') {
          try {
            await requireTripRole(db, message.tripId, conn.userId, 'viewer');
          } catch {
            send(conn, {
              kind: 'error',
              code: 'not_found',
              message: 'Trip not found',
              tripId: message.tripId,
            });
            return;
          }
          await join(conn, message.tripId);
          send(conn, { kind: 'subscribed', tripId: message.tripId });
        } else if (message.op === 'unsubscribe') {
          await leave(conn, message.tripId);
        } else if (message.op === 'editing' && conn.trips.has(message.tripId)) {
          conn.editing.set(message.tripId, message.itemId);
          await publishPresence(conn, message.tripId, message.itemId);
        }
      });
    },
  );

  return app;
};
