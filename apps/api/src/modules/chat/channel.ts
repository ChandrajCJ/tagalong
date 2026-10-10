import { and, eq, inArray } from 'drizzle-orm';
import { channels, messages, users, type Db, type Tx } from '@tagalong/db';
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
): ChatMessage => ({
  id: row.id,
  tripId: row.tripId,
  senderId: row.senderId,
  senderName,
  kind: row.kind as ChatMessage['kind'],
  body: row.body,
  replyToId: row.replyToId,
  replyTo,
  payload: (row.payload as Record<string, unknown> | null) ?? null,
  createdAt: row.createdAt.toISOString(),
  reactions,
  poll,
  itemId,
});

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
