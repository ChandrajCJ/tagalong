import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  channels,
  messages,
  pollOptions,
  pollVotes,
  polls,
  reactions,
  readStates,
  tripMembers,
  users,
  type Db,
} from '@tagalong/db';
import {
  CreatePollInput,
  newId,
  SendMessageInput,
  type ChatMessage,
  type MessagePage,
  type Poll,
  type ReadState,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Jobs } from '../../lib/jobs';
import { mainChannelId, toMessage } from './channel';

type SendMessage = z.output<typeof SendMessageInput>;
type CreatePoll = z.output<typeof CreatePollInput>;

/** Cursors are opaque to the app: "<created_at ISO>|<id>", base64url. */
const encodeCursor = (m: { createdAt: Date; id: string }) =>
  Buffer.from(`${m.createdAt.toISOString()}|${m.id}`).toString('base64url');
const decodeCursor = (cursor: string) => {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime())) throw badRequest('Invalid cursor');
  return { at, id };
};

export const createChatService = (db: Db, redis: Redis, jobs: Jobs) => {
  /** Reactions for these messages, grouped as the app shows them. */
  const reactionsFor = async (messageIds: string[], userId: string) => {
    const grouped = new Map<string, ChatMessage['reactions']>();
    if (messageIds.length === 0) return grouped;
    const rows = await db
      .select({ messageId: reactions.messageId, emoji: reactions.emoji, userId: reactions.userId })
      .from(reactions)
      .where(inArray(reactions.messageId, messageIds))
      .orderBy(reactions.createdAt);
    for (const r of rows) {
      const list = grouped.get(r.messageId) ?? [];
      const entry = list.find((e) => e.emoji === r.emoji);
      if (entry) {
        entry.count += 1;
        entry.mine ||= r.userId === userId;
      } else {
        list.push({ emoji: r.emoji, count: 1, mine: r.userId === userId });
      }
      grouped.set(r.messageId, list);
    }
    return grouped;
  };

  const readStatesFor = async (channelId: string): Promise<ReadState[]> => {
    const rows = await db
      .select({ userId: readStates.userId, lastReadAt: readStates.lastReadAt })
      .from(readStates)
      .where(eq(readStates.channelId, channelId));
    return rows.map((r) => ({ userId: r.userId, lastReadAt: r.lastReadAt.toISOString() }));
  };

  /** Moves someone's read marker forward (never back). */
  const advanceRead = async (channelId: string, userId: string, messageId: string, at: Date) => {
    const [row] = await db
      .insert(readStates)
      .values({ channelId, userId, lastReadMessageId: messageId, lastReadAt: at })
      .onConflictDoUpdate({
        target: [readStates.channelId, readStates.userId],
        set: {
          lastReadMessageId: sql`case when excluded.last_read_at > ${readStates.lastReadAt} then excluded.last_read_message_id else ${readStates.lastReadMessageId} end`,
          lastReadAt: sql`greatest(${readStates.lastReadAt}, excluded.last_read_at)`,
        },
      })
      .returning({ lastReadAt: readStates.lastReadAt });
    return row!.lastReadAt;
  };

  /** Polls attached to these messages, with their options and who voted. */
  const pollsFor = async (messageIds: string[], userId: string) => {
    const byMessage = new Map<string, Poll>();
    if (messageIds.length === 0) return byMessage;

    const pollRows = await db.select().from(polls).where(inArray(polls.messageId, messageIds));
    if (pollRows.length === 0) return byMessage;
    const pollIds = pollRows.map((p) => p.id);

    const optionRows = await db
      .select()
      .from(pollOptions)
      .where(inArray(pollOptions.pollId, pollIds))
      .orderBy(pollOptions.position);
    const voteRows = await db
      .select({
        pollId: pollVotes.pollId,
        optionId: pollVotes.optionId,
        userId: pollVotes.userId,
        displayName: users.displayName,
      })
      .from(pollVotes)
      .innerJoin(users, eq(users.id, pollVotes.userId))
      .where(inArray(pollVotes.pollId, pollIds));

    for (const p of pollRows) {
      const votes = voteRows.filter((v) => v.pollId === p.id);
      byMessage.set(p.messageId, {
        id: p.id,
        question: p.question,
        multi: p.multi,
        closedAt: p.closedAt?.toISOString() ?? null,
        createdBy: p.createdBy,
        options: optionRows
          .filter((o) => o.pollId === p.id)
          .map((o) => {
            const mine = votes.filter((v) => v.optionId === o.id);
            return {
              id: o.id,
              label: o.label,
              votes: mine.length,
              voters: mine.map((v) => ({ userId: v.userId, displayName: v.displayName })),
              mine: mine.some((v) => v.userId === userId),
            };
          }),
        voterCount: new Set(votes.map((v) => v.userId)).size,
      });
    }
    return byMessage;
  };

  /** Reads one poll back in the shape the app expects. */
  const hydratePoll = async (messageId: string, userId: string) => {
    const poll = (await pollsFor([messageId], userId)).get(messageId);
    if (!poll) throw notFound('Poll not found');
    return poll;
  };

  const loadMessage = async (messageId: string) => {
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)));
    if (!row) throw notFound('Message not found');
    return row;
  };

  return {
    /** Newest first. Pass `before` (a cursor) to page back through history. */
    async list(tripId: string, userId: string, before?: string, limit = 30): Promise<MessagePage> {
      await requireTripRole(db, tripId, userId, 'viewer');
      const channelId = await mainChannelId(db, tripId);
      const cursor = before ? decodeCursor(before) : null;

      const rows = await db
        .select({ message: messages, senderName: users.displayName })
        .from(messages)
        .leftJoin(users, eq(users.id, messages.senderId))
        .where(
          and(
            eq(messages.channelId, channelId),
            isNull(messages.deletedAt),
            cursor
              ? sql`(${messages.createdAt}, ${messages.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const ids = page.map((r) => r.message.id);
      const grouped = await reactionsFor(ids, userId);
      const polled = await pollsFor(ids, userId);
      const last = page.at(-1);
      return {
        messages: page.map((r) =>
          toMessage(r.message, r.senderName, grouped.get(r.message.id), polled.get(r.message.id)),
        ),
        nextCursor: rows.length > limit && last ? encodeCursor(last.message) : null,
        readStates: await readStatesFor(channelId),
      };
    },

    /** Retrying with the same client-generated id returns the same message. */
    async send(tripId: string, userId: string, input: SendMessage, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();
      const channelId = await mainChannelId(db, tripId);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(messages)
          .values({
            id,
            channelId,
            tripId,
            senderId: userId,
            kind: 'text',
            body: input.body,
            replyToId: input.replyToId ?? null,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(messages).where(eq(messages.id, id));
          if (!existing || existing.senderId !== userId || existing.tripId !== tripId) {
            throw conflict('A message with that id already exists');
          }
          return { row: existing, created: false };
        }
        await tx.update(channels).set({ lastMessageAt: now }).where(eq(channels.id, channelId));
        return { row: inserted, created: true };
      });

      const [sender] = await db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, userId));
      const message = toMessage(result.row, sender?.name ?? null);
      if (!result.created) return { message, created: false };

      // You've obviously read your own message.
      await advanceRead(channelId, userId, message.id, result.row.createdAt);
      await publishTripEvent(redis, {
        type: 'message.created',
        tripId,
        entityId: message.id,
        actorId: userId,
        payload: message,
        originClientId: origin,
      });

      // Everyone else may get a push; the worker skips whoever is online.
      const others = await db
        .select({ userId: tripMembers.userId })
        .from(tripMembers)
        .where(
          and(
            eq(tripMembers.tripId, tripId),
            isNull(tripMembers.leftAt),
            ne(tripMembers.userId, userId),
          ),
        );
      await jobs.notifyChat(
        tripId,
        others.map((o) => o.userId),
      );
      return { message, created: true };
    },

    async toggleReaction(messageId: string, userId: string, emoji: string, origin?: string) {
      const row = await loadMessage(messageId);
      await requireTripRole(db, row.tripId, userId, 'viewer');

      const removed = await db
        .delete(reactions)
        .where(
          and(
            eq(reactions.messageId, messageId),
            eq(reactions.userId, userId),
            eq(reactions.emoji, emoji),
          ),
        )
        .returning({ emoji: reactions.emoji });
      if (removed.length === 0) {
        await db.insert(reactions).values({ messageId, userId, emoji }).onConflictDoNothing();
      }

      const list = (await reactionsFor([messageId], userId)).get(messageId) ?? [];
      await publishTripEvent(redis, {
        type: 'reaction.changed',
        tripId: row.tripId,
        entityId: messageId,
        actorId: userId,
        payload: { messageId, emoji, userId, added: removed.length === 0 },
        originClientId: origin,
      });
      return { messageId, reactions: list };
    },

    /**
     * A poll is a chat message with options attached, so it shows up in the
     * conversation where the decision is being made.
     */
    async createPoll(tripId: string, userId: string, input: CreatePoll, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      const id = input.id ?? newId();
      const channelId = await mainChannelId(db, tripId);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(messages)
          .values({
            id,
            channelId,
            tripId,
            senderId: userId,
            kind: 'poll',
            body: input.question,
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning();

        if (!inserted) {
          const [existing] = await tx.select().from(messages).where(eq(messages.id, id));
          if (!existing || existing.senderId !== userId || existing.tripId !== tripId) {
            throw conflict('A message with that id already exists');
          }
          return { row: existing, created: false };
        }

        const [poll] = await tx
          .insert(polls)
          .values({
            messageId: id,
            tripId,
            question: input.question,
            multi: input.multi,
            createdBy: userId,
          })
          .returning({ id: polls.id });
        await tx
          .insert(pollOptions)
          .values(input.options.map((label, i) => ({ pollId: poll!.id, label, position: i })));
        await tx.update(channels).set({ lastMessageAt: now }).where(eq(channels.id, channelId));
        return { row: inserted, created: true };
      });

      const [sender] = await db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, userId));
      const message = toMessage(
        result.row,
        sender?.name ?? null,
        [],
        await hydratePoll(id, userId),
      );
      if (!result.created) return { message, created: false };

      await advanceRead(channelId, userId, message.id, result.row.createdAt);
      await publishTripEvent(redis, {
        type: 'message.created',
        tripId,
        entityId: message.id,
        actorId: userId,
        payload: message,
        originClientId: origin,
      });
      return { message, created: true };
    },

    /**
     * Replaces this person's picks. An empty list clears their vote, and on a
     * single-choice poll only the first option counts. Viewers may vote.
     */
    async votePoll(pollId: string, userId: string, optionIds: string[], origin?: string) {
      const [poll] = await db.select().from(polls).where(eq(polls.id, pollId));
      if (!poll) throw notFound('Poll not found');
      await requireTripRole(db, poll.tripId, userId, 'viewer');
      if (poll.closedAt) throw conflict('This poll is closed');

      const valid = await db
        .select({ id: pollOptions.id })
        .from(pollOptions)
        .where(eq(pollOptions.pollId, pollId));
      const allowed = new Set(valid.map((o) => o.id));
      const picks = [...new Set(optionIds)].filter((o) => allowed.has(o));
      if (picks.length !== new Set(optionIds).size) throw badRequest('Unknown poll option');
      const chosen = poll.multi ? picks : picks.slice(0, 1);

      await db.transaction(async (tx) => {
        await tx
          .delete(pollVotes)
          .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)));
        if (chosen.length > 0) {
          await tx
            .insert(pollVotes)
            .values(chosen.map((optionId) => ({ optionId, pollId, userId })));
        }
      });

      const result = await hydratePoll(poll.messageId, userId);
      await publishTripEvent(redis, {
        type: 'poll.voted',
        tripId: poll.tripId,
        entityId: poll.messageId,
        actorId: userId,
        payload: { messageId: poll.messageId, poll: result },
        originClientId: origin,
      });
      return result;
    },

    /** Only the person who asked, or a trip owner, can close a poll. */
    async closePoll(pollId: string, userId: string, origin?: string) {
      const [poll] = await db.select().from(polls).where(eq(polls.id, pollId));
      if (!poll) throw notFound('Poll not found');
      const role = await requireTripRole(db, poll.tripId, userId, 'viewer');
      if (poll.createdBy !== userId && role !== 'owner') {
        throw forbidden('Only the person who asked can close this poll');
      }
      if (!poll.closedAt) {
        await db.update(polls).set({ closedAt: new Date() }).where(eq(polls.id, pollId));
      }

      const result = await hydratePoll(poll.messageId, userId);
      await publishTripEvent(redis, {
        type: 'poll.closed',
        tripId: poll.tripId,
        entityId: poll.messageId,
        actorId: userId,
        payload: { messageId: poll.messageId, poll: result },
        originClientId: origin,
      });
      return result;
    },

    async markRead(tripId: string, userId: string, messageId: string, origin?: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      const row = await loadMessage(messageId);
      if (row.tripId !== tripId) throw notFound('Message not found');
      const lastReadAt = await advanceRead(row.channelId, userId, messageId, row.createdAt);
      await publishTripEvent(redis, {
        type: 'read.updated',
        tripId,
        entityId: userId,
        actorId: userId,
        payload: { userId, lastReadAt: lastReadAt.toISOString() },
        originClientId: origin,
      });
      return { lastReadAt: lastReadAt.toISOString() };
    },
  };
};
