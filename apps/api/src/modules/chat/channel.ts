import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { channels, messages, readStates, tripMembers, users, type Db, type Tx } from '@tagalong/db';
import { newId, type ChatMessage, type Poll } from '@tagalong/shared';

type MessageRow = typeof messages.$inferSelect;

export const toMessage = (
  row: MessageRow,
  senderName: string | null,
  reactions: ChatMessage['reactions'] = [],
  poll: Poll | null = null,
  /** Set when the message belongs to a plan item's thread, not the main chat. */
  itemId: string | null = null,
  replyTo: ChatMessage['replyTo'] = null,
): ChatMessage => {
  // A deleted message keeps its place in the conversation and nothing else.
  const deleted = row.deletedAt !== null;
  return {
    id: row.id,
    tripId: row.tripId,
    senderId: row.senderId,
    senderName,
    kind: row.kind as ChatMessage['kind'],
    body: deleted ? '' : row.body,
    replyToId: row.replyToId,
    replyTo: deleted ? null : replyTo,
    payload: deleted ? null : ((row.payload as Record<string, unknown> | null) ?? null),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    reactions: deleted ? [] : reactions,
    poll: deleted ? null : poll,
    itemId,
  };
};

/**
 * How many main-chat messages each trip has that this person hasn't read:
 * newer than their read marker (or than when they joined, if they never
 * opened the chat), not theirs, and not deleted. Activity cards about their
 * own doing don't count either. One grouped query for all the trips.
 */
export const unreadCounts = async (db: Db | Tx, userId: string, tripIds: string[]) => {
  const counts = new Map<string, number>();
  if (tripIds.length === 0) return counts;
  const rows = await db
    .select({ tripId: channels.tripId, count: sql<number>`count(*)::int` })
    .from(channels)
    .innerJoin(
      tripMembers,
      and(eq(tripMembers.tripId, channels.tripId), eq(tripMembers.userId, userId), isNull(tripMembers.leftAt)),
    )
    .leftJoin(readStates, and(eq(readStates.channelId, channels.id), eq(readStates.userId, userId)))
    .innerJoin(
      messages,
      and(
        eq(messages.channelId, channels.id),
        isNull(messages.deletedAt),
        sql`${messages.createdAt} > coalesce(${readStates.lastReadAt}, ${tripMembers.joinedAt})`,
        sql`coalesce(${messages.senderId}::text, ${messages.payload}->>'actorId', '') <> ${userId}`,
      ),
    )
    .where(and(inArray(channels.tripId, tripIds), eq(channels.kind, 'trip')))
    .groupBy(channels.tripId);
  for (const r of rows) counts.set(r.tripId, r.count);
  return counts;
};

/** How much of the original a reply shows: enough to recognise it. */
const QUOTE_LENGTH = 140;

/** Previews of the messages these replies answer, by id. */
export const quotesFor = async (db: Db | Tx, replyToIds: (string | null)[]) => {
  const ids = [...new Set(replyToIds.filter((id): id is string => !!id))];
  const quotes = new Map<string, NonNullable<ChatMessage['replyTo']>>();
  if (ids.length === 0) return quotes;
  const rows = await db
    .select({ id: messages.id, body: messages.body, deletedAt: messages.deletedAt, senderName: users.displayName })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.senderId))
    .where(inArray(messages.id, ids));
  for (const r of rows) {
    const deleted = r.deletedAt !== null;
    quotes.set(r.id, {
      id: r.id,
      senderName: r.senderName,
      body: deleted ? '' : r.body.length > QUOTE_LENGTH ? `${r.body.slice(0, QUOTE_LENGTH - 1)}…` : r.body,
      deleted,
    });
  }
  return quotes;
};

/** The trip's main chat channel, created on first use. */
export const mainChannelId = async (db: Db | Tx, tripId: string): Promise<string> => {
  const find = () =>
    db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.tripId, tripId), eq(channels.kind, 'trip')))
      .limit(1);
  const [existing] = await find();
  if (existing) return existing.id;
  const [created] = await db
    .insert(channels)
    .values({ tripId, kind: 'trip' })
    .onConflictDoNothing()
    .returning({ id: channels.id });
  if (created) return created.id;
  const [raced] = await find(); // someone else created it in the meantime
  return raced!.id;
};

/** A plan item's own thread, created the first time anyone opens or posts in it. */
export const itemChannelId = async (db: Db | Tx, tripId: string, itemId: string): Promise<string> => {
  const find = () =>
    db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.itemId, itemId), eq(channels.kind, 'item')))
      .limit(1);
  const [existing] = await find();
  if (existing) return existing.id;
  const [created] = await db
    .insert(channels)
    .values({ tripId, kind: 'item', itemId })
    .onConflictDoNothing()
    .returning({ id: channels.id });
  if (created) return created.id;
  const [raced] = await find();
  return raced!.id;
};

/**
 * An activity card in the chat ("Riya joined the trip"). Write it inside the
 * same transaction as the change it describes, and publish it after commit.
 */
export const postSystemMessage = async (
  tx: Tx,
  tripId: string,
  actorId: string,
  describe: (actorName: string) => string,
  payload: Record<string, unknown>,
): Promise<ChatMessage> => {
  const [actor] = await tx
    .select({ name: users.displayName })
    .from(users)
    .where(eq(users.id, actorId));
  const channelId = await mainChannelId(tx, tripId);
  const now = new Date();
  const [row] = await tx
    .insert(messages)
    .values({
      id: newId(),
      channelId,
      tripId,
      senderId: null,
      kind: 'system',
      body: describe(actor?.name ?? 'Someone'),
      payload: { ...payload, actorId },
      createdAt: now,
    })
    .returning();
  await tx.update(channels).set({ lastMessageAt: now }).where(eq(channels.id, channelId));
  return toMessage(row!, null);
};
