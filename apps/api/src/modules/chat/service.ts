import { and, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  changeLog,
  channels,
  items,
  messages,
  photos,
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
  MESSAGE_EDIT_WINDOW_MS,
  newId,
  SendMessageInput,
  type ChatImage,
  type ChatMessage,
  type MessageInfo,
  type MessagePage,
  type Poll,
  type ItineraryItem,
  type ReadState,
} from '@tagalong/shared';
import type { Redis } from 'ioredis';
import type { z } from 'zod';
import { requireTripRole } from '../../lib/access';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { publishTripEvent } from '../../lib/events';
import type { Jobs } from '../../lib/jobs';
import { firstUrl } from '../../lib/link-preview';
import type { Storage } from '../../lib/storage';
import { endOfDay, toItem } from '../itinerary/service';
import { itemChannelId, mainChannelId, postSystemMessage, quotesFor, toMessage, unreadCounts } from './channel';

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

type MessageRow = typeof messages.$inferSelect;

/** The photo ids an image message carries. */
const mediaIdsOf = (row: { kind: string; payload: unknown }) =>
  row.kind === 'image' ? (((row.payload as { mediaIds?: string[] } | null)?.mediaIds ?? []) as string[]) : [];

export const createChatService = (db: Db, redis: Redis, jobs: Jobs, storage: Storage, ttl: number) => {
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

  /** Whether this person shares when they've read messages (and so sees others'). */
  const readReceiptsOn = async (userId: string) => {
    const [row] = await db.select({ on: users.readReceipts }).from(users).where(eq(users.id, userId));
    return row?.on ?? true;
  };

  /**
   * How far everyone has received and read, as this viewer may see it. Read
   * times are hidden for people with read receipts off, and from a viewer
   * with theirs off; their own always shows.
   */
  const readStatesFor = async (channelId: string, viewerId: string): Promise<ReadState[]> => {
    const viewerShares = await readReceiptsOn(viewerId);
    const rows = await db
      .select({
        userId: readStates.userId,
        lastReadAt: readStates.lastReadAt,
        lastDeliveredAt: readStates.lastDeliveredAt,
        shares: users.readReceipts,
      })
      .from(readStates)
      .innerJoin(users, eq(users.id, readStates.userId))
      .where(eq(readStates.channelId, channelId));
    return rows.map((r) => {
      const self = r.userId === viewerId;
      const shown = self || (viewerShares && r.shares);
      return {
        userId: r.userId,
        lastReadAt: shown ? (r.lastReadAt?.toISOString() ?? null) : null,
        lastDeliveredAt: r.lastDeliveredAt?.toISOString() ?? null,
        readHidden: !self && !r.shares,
      };
    });
  };

  /** Moves someone's read marker forward (never back). Reading also means it arrived. */
  const advanceRead = async (channelId: string, userId: string, messageId: string, at: Date) => {
    const [row] = await db
      .insert(readStates)
      .values({ channelId, userId, lastReadMessageId: messageId, lastReadAt: at, lastDeliveredAt: at })
      .onConflictDoUpdate({
        target: [readStates.channelId, readStates.userId],
        set: {
          lastReadMessageId: sql`case when excluded.last_read_at > coalesce(${readStates.lastReadAt}, '-infinity') then excluded.last_read_message_id else ${readStates.lastReadMessageId} end`,
          lastReadAt: sql`greatest(${readStates.lastReadAt}, excluded.last_read_at)`,
          lastDeliveredAt: sql`greatest(${readStates.lastDeliveredAt}, excluded.last_delivered_at)`,
        },
      })
      .returning({ lastReadAt: readStates.lastReadAt, lastDeliveredAt: readStates.lastDeliveredAt });
    return { lastReadAt: row!.lastReadAt!, lastDeliveredAt: row!.lastDeliveredAt! };
  };

  /**
   * Moves someone's "received up to" marker forward. Returns the new marker
   * and whether it moved, so a repeated ack announces nothing.
   */
  const advanceDelivered = async (channelId: string, userId: string, at: Date) => {
    const [before] = await db
      .select({ at: readStates.lastDeliveredAt })
      .from(readStates)
      .where(and(eq(readStates.channelId, channelId), eq(readStates.userId, userId)));
    const [row] = await db
      .insert(readStates)
      .values({ channelId, userId, lastDeliveredAt: at })
      .onConflictDoUpdate({
        target: [readStates.channelId, readStates.userId],
        set: { lastDeliveredAt: sql`greatest(${readStates.lastDeliveredAt}, excluded.last_delivered_at)` },
      })
      .returning({ lastDeliveredAt: readStates.lastDeliveredAt });
    const now = row!.lastDeliveredAt!;
    return { lastDeliveredAt: now, moved: !before?.at || now > before.at };
  };

  /** Signed links to the photos in these image messages, by message. */
  const imagesFor = async (rows: MessageRow[]) => {
    const byMessage = new Map<string, ChatImage[]>();
    const ids = [...new Set(rows.filter((r) => !r.deletedAt).flatMap(mediaIdsOf))];
    if (ids.length === 0) return byMessage;
    const found = await db
      .select()
      .from(photos)
      .where(and(inArray(photos.id, ids), isNull(photos.deletedAt), eq(photos.status, 'ready')));
    const signed = new Map(
      await Promise.all(
        found.map(
          async (p): Promise<[string, ChatImage]> => [
            p.id,
            {
              id: p.id,
              width: p.width,
              height: p.height,
              thumbUrl: p.thumbKey ? await storage.downloadUrl(p.thumbKey, `${p.id}.webp`, ttl) : null,
              url: await storage.downloadUrl(p.storageKey, `${p.id}.jpg`, ttl),
              inAlbum: p.source === 'album',
            },
          ],
        ),
      ),
    );
    for (const row of rows) {
      const list = mediaIdsOf(row).flatMap((id) => (signed.has(id) ? [signed.get(id)!] : []));
      if (list.length > 0) byMessage.set(row.id, list);
    }
    return byMessage;
  };

  /** The people mentioned who are on the trip now; anyone else, and the sender, are dropped. */
  const validMentions = async (tripId: string, senderId: string, ids: string[]) => {
    const wanted = [...new Set(ids)].filter((id) => id !== senderId);
    if (wanted.length === 0) return [];
    const rows = await db
      .select({ userId: tripMembers.userId })
      .from(tripMembers)
      .where(and(eq(tripMembers.tripId, tripId), inArray(tripMembers.userId, wanted), isNull(tripMembers.leftAt)));
    const members = new Set(rows.map((r) => r.userId));
    return wanted.filter((id) => members.has(id));
  };

  /** Photos to send must be this person's own, uploaded to this trip, and finished. */
  const checkMedia = async (tripId: string, userId: string, mediaIds: string[]) => {
    const ids = [...new Set(mediaIds)];
    const rows = await db
      .select({ id: photos.id })
      .from(photos)
      .where(
        and(
          inArray(photos.id, ids),
          eq(photos.tripId, tripId),
          eq(photos.uploadedBy, userId),
          eq(photos.status, 'ready'),
          isNull(photos.deletedAt),
          inArray(photos.source, ['chat', 'album']),
        ),
      );
    if (rows.length !== ids.length) throw badRequest('Some of those photos haven’t finished uploading. Try again.');
    return ids;
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
    // An option's plan item only counts while it still exists.
    const linked = optionRows.map((o) => o.itemId).filter((x): x is string => !!x);
    const liveItems = new Set(
      linked.length === 0
        ? []
        : (
            await db
              .select({ id: items.id })
              .from(items)
              .where(and(inArray(items.id, linked), isNull(items.deletedAt)))
          ).map((r) => r.id),
    );

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
              itemId: o.itemId && liveItems.has(o.itemId) ? o.itemId : null,
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

  const loadMessage = async (messageId: string, { includeDeleted = false } = {}) => {
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), includeDeleted ? undefined : isNull(messages.deletedAt)));
    if (!row) throw notFound('Message not found');
    return row;
  };

  /** The plan item whose thread a channel is, or null for the main chat. */
  const itemOfChannel = async (channelId: string) => {
    const [channel] = await db
      .select({ itemId: channels.itemId })
      .from(channels)
      .where(eq(channels.id, channelId));
    return channel?.itemId ?? null;
  };

  /** One page of a channel, newest first. Shared by the main chat and item threads. */
  const pageOf = async (
    channelId: string,
    userId: string,
    itemId: string | null,
    before?: string,
    limit = 30,
  ): Promise<MessagePage> => {
    const cursor = before ? decodeCursor(before) : null;
    const rows = await db
      .select({ message: messages, senderName: users.displayName })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.senderId))
      .where(
        and(
          // Deleted messages stay as "Message deleted", so replies still make sense.
          eq(messages.channelId, channelId),
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
    const quotes = await quotesFor(db, page.map((r) => r.message.replyToId));
    const images = await imagesFor(page.map((r) => r.message));
    const last = page.at(-1);
    return {
      messages: page.map((r) =>
        toMessage(
          r.message,
          r.senderName,
          grouped.get(r.message.id),
          polled.get(r.message.id),
          itemId,
          r.message.replyToId ? (quotes.get(r.message.replyToId) ?? null) : null,
          images.get(r.message.id),
        ),
      ),
      nextCursor: rows.length > limit && last ? encodeCursor(last.message) : null,
      readStates: await readStatesFor(channelId, userId),
    };
  };

  /**
   * Writes a message, with text, photos or both, into a channel. Retrying
   * with the same client-generated id returns the same message.
   */
  const post = async (
    tripId: string,
    channelId: string,
    itemId: string | null,
    userId: string,
    input: SendMessage,
    origin?: string,
  ) => {
    const id = input.id ?? newId();
    const now = new Date();

    // A reply answers a message in the same conversation, never one elsewhere.
    if (input.replyToId) {
      const [original] = await db
        .select({ channelId: messages.channelId })
        .from(messages)
        .where(and(eq(messages.id, input.replyToId), isNull(messages.deletedAt)));
      if (original?.channelId !== channelId) throw badRequest('That message isn’t in this chat');
    }

    const mediaIds = input.mediaIds.length > 0 ? await checkMedia(tripId, userId, input.mediaIds) : [];
    const mentions = await validMentions(tripId, userId, input.mentions);
    const kind = mediaIds.length > 0 ? 'image' : 'text';
    const payload = {
      ...(mediaIds.length > 0 ? { mediaIds } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
    };

    const result = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(messages)
        .values({
          id,
          channelId,
          tripId,
          senderId: userId,
          kind,
          body: input.body,
          replyToId: input.replyToId ?? null,
          payload: Object.keys(payload).length > 0 ? payload : null,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();

      if (!inserted) {
        const [existing] = await tx.select().from(messages).where(eq(messages.id, id));
        if (
          !existing ||
          existing.senderId !== userId ||
          existing.tripId !== tripId ||
          existing.channelId !== channelId
        ) {
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
    const quotes = await quotesFor(db, [result.row.replyToId]);
    const message = toMessage(
      result.row,
      sender?.name ?? null,
      [],
      null,
      itemId,
      result.row.replyToId ? (quotes.get(result.row.replyToId) ?? null) : null,
      (await imagesFor([result.row])).get(result.row.id),
    );
    if (!result.created) return { message, created: false };

    // Mentioned people hear about it now, not in the next summary.
    await jobs.notifyMention(tripId, message.id, mentions);
    if (kind === 'text' && firstUrl(input.body)) await jobs.linkPreview(message.id);

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

    /*
     * Pushes are for the main chat only. A thread is a side conversation
     * about one item, and the push summary ("5 new messages") counts the
     * main chat, so a thread message would announce nothing it could show.
     */
    if (itemId === null) {
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
    }
    return { message, created: true };
  };

  /** The plan item a thread hangs off, with access checked. */
  const threadOf = async (itemId: string, userId: string, minRole: 'viewer' | 'editor') => {
    const [item] = await db
      .select({ tripId: items.tripId })
      .from(items)
      .where(and(eq(items.id, itemId), isNull(items.deletedAt)));
    if (!item) throw notFound('That item no longer exists');
    await requireTripRole(db, item.tripId, userId, minRole);
    return { tripId: item.tripId, channelId: await itemChannelId(db, item.tripId, itemId) };
  };

  return {
    /** Newest first. Pass `before` (a cursor) to page back through history. */
    async list(tripId: string, userId: string, before?: string, limit = 30): Promise<MessagePage> {
      await requireTripRole(db, tripId, userId, 'viewer');
      return pageOf(await mainChannelId(db, tripId), userId, null, before, limit);
    },

    async send(tripId: string, userId: string, input: SendMessage, origin?: string) {
      await requireTripRole(db, tripId, userId, 'editor');
      return post(tripId, await mainChannelId(db, tripId), null, userId, input, origin);
    },

    /** A plan item's own thread, so a debate about one restaurant stays with it. */
    async listThread(itemId: string, userId: string, before?: string, limit = 30) {
      const { channelId } = await threadOf(itemId, userId, 'viewer');
      return pageOf(channelId, userId, itemId, before, limit);
    },

    async sendThread(itemId: string, userId: string, input: SendMessage, origin?: string) {
      const { tripId, channelId } = await threadOf(itemId, userId, 'editor');
      return post(tripId, channelId, itemId, userId, input, origin);
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

    /**
     * Turns a poll option into a plan item: the group voted, now it goes on a
     * day. Once added, the option points at its item, so it can't be added
     * twice; if that item is later deleted, the option can be added again.
     */
    async addOptionToPlan(
      pollId: string,
      optionId: string,
      userId: string,
      date: string | null,
      origin?: string,
    ): Promise<{ poll: Poll; item: ItineraryItem }> {
      const [poll] = await db.select().from(polls).where(eq(polls.id, pollId));
      if (!poll) throw notFound('Poll not found');
      await requireTripRole(db, poll.tripId, userId, 'editor');
      const [option] = await db
        .select()
        .from(pollOptions)
        .where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, pollId)));
      if (!option) throw notFound('That option isn’t in this poll');

      if (option.itemId) {
        const [existing] = await db
          .select()
          .from(items)
          .where(and(eq(items.id, option.itemId), isNull(items.deletedAt)));
        if (existing) return { poll: await hydratePoll(poll.messageId, userId), item: toItem(existing) };
      }

      const result = await db.transaction(async (tx) => {
        const itemId = newId();
        const [item] = await tx
          .insert(items)
          .values({
            id: itemId,
            tripId: poll.tripId,
            date,
            position: await endOfDay(tx, poll.tripId, date),
            type: 'activity',
            title: option.label,
            notes: `Picked in the poll “${poll.question}”`,
            createdBy: userId,
          })
          .returning();
        await tx.update(pollOptions).set({ itemId }).where(eq(pollOptions.id, optionId));
        await tx
          .insert(changeLog)
          .values({ tripId: poll.tripId, entity: 'item', entityId: itemId, op: 'upsert', changedBy: userId });
        const card = await postSystemMessage(
          tx,
          poll.tripId,
          userId,
          (name) => `${name} added “${option.label}” to the plan, from the poll`,
          { event: 'poll_option_planned', pollId, optionId, itemId },
        );
        return { item: toItem(item!), card };
      });

      const updated = await hydratePoll(poll.messageId, userId);
      await publishTripEvent(redis, {
        type: 'item.upserted',
        tripId: poll.tripId,
        entityId: result.item.id,
        actorId: userId,
        version: result.item.version,
        payload: result.item,
        originClientId: origin,
      });
      await publishTripEvent(redis, {
        type: 'poll.voted',
        tripId: poll.tripId,
        entityId: poll.messageId,
        actorId: userId,
        payload: { messageId: poll.messageId, poll: updated },
        originClientId: origin,
      });
      await publishTripEvent(redis, {
        type: 'message.created',
        tripId: poll.tripId,
        entityId: result.card.id,
        actorId: userId,
        payload: result.card,
      });
      return { poll: updated, item: result.item };
    },

    async markRead(tripId: string, userId: string, messageId: string, origin?: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      // The newest message on screen may be a deleted one; reading up to it still counts.
      const row = await loadMessage(messageId, { includeDeleted: true });
      if (row.tripId !== tripId) throw notFound('Message not found');
      const { lastReadAt, lastDeliveredAt } = await advanceRead(row.channelId, userId, messageId, row.createdAt);
      // Say which conversation this was, so reading a thread doesn't move the main chat's ticks.
      // With read receipts off, others only learn that it arrived.
      const shares = await readReceiptsOn(userId);
      await publishTripEvent(redis, {
        type: 'read.updated',
        tripId,
        entityId: userId,
        actorId: userId,
        payload: {
          userId,
          lastReadAt: shares ? lastReadAt.toISOString() : null,
          lastDeliveredAt: lastDeliveredAt.toISOString(),
          readHidden: !shares,
          itemId: await itemOfChannel(row.channelId),
        },
        originClientId: origin,
      });
      return { lastReadAt: lastReadAt.toISOString() };
    },

    /**
     * "My phone has received up to this message", whether over the live
     * connection or by fetching after being offline. Repeats are harmless.
     */
    async markDelivered(tripId: string, userId: string, messageId: string, origin?: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      const row = await loadMessage(messageId, { includeDeleted: true });
      if (row.tripId !== tripId) throw notFound('Message not found');
      const { lastDeliveredAt, moved } = await advanceDelivered(row.channelId, userId, row.createdAt);
      if (moved) {
        await publishTripEvent(redis, {
          type: 'delivery.updated',
          tripId,
          entityId: userId,
          actorId: userId,
          payload: { userId, lastDeliveredAt: lastDeliveredAt.toISOString(), itemId: await itemOfChannel(row.channelId) },
          originClientId: origin,
        });
      }
      return { lastDeliveredAt: lastDeliveredAt.toISOString() };
    },

    /**
     * Who has received and read one of my messages. Only people on the trip
     * when it was sent count; people who left since don't.
     */
    async info(messageId: string, userId: string): Promise<MessageInfo> {
      const row = await loadMessage(messageId);
      await requireTripRole(db, row.tripId, userId, 'viewer');
      if (row.senderId !== userId) throw forbidden('Only the sender can see who has read a message');
      const readsShown = await readReceiptsOn(userId);

      const people = await db
        .select({
          userId: users.id,
          displayName: users.displayName,
          shares: users.readReceipts,
          lastReadAt: readStates.lastReadAt,
          lastDeliveredAt: readStates.lastDeliveredAt,
        })
        .from(tripMembers)
        .innerJoin(users, eq(users.id, tripMembers.userId))
        .leftJoin(readStates, and(eq(readStates.channelId, row.channelId), eq(readStates.userId, tripMembers.userId)))
        .where(
          and(
            eq(tripMembers.tripId, row.tripId),
            isNull(tripMembers.leftAt),
            ne(tripMembers.userId, userId),
            lte(tripMembers.joinedAt, row.createdAt),
          ),
        )
        .orderBy(users.displayName);

      const info: MessageInfo = { readBy: [], deliveredTo: [], notDelivered: [], readsShown };
      const reached = (at: Date | null) => !!at && at >= row.createdAt;
      for (const p of people) {
        const person = { userId: p.userId, displayName: p.displayName };
        if (readsShown && p.shares && reached(p.lastReadAt)) {
          info.readBy.push({ ...person, at: p.lastReadAt!.toISOString() });
        } else if (reached(p.lastDeliveredAt) || reached(p.lastReadAt)) {
          info.deliveredTo.push({ ...person, at: reached(p.lastDeliveredAt) ? p.lastDeliveredAt!.toISOString() : null });
        } else {
          info.notDelivered.push(person);
        }
      }
      return info;
    },

    /** Main-chat messages I haven't read, for the Chat tab's badge. */
    async unread(tripId: string, userId: string) {
      await requireTripRole(db, tripId, userId, 'viewer');
      return { chat: (await unreadCounts(db, userId, [tripId])).get(tripId) ?? 0 };
    },

    /**
     * Fixes a typo: the sender only, text messages only, and only for a day
     * after sending, so an old message can't quietly change meaning.
     */
    async edit(
      messageId: string,
      userId: string,
      body: string,
      mentionIds: string[] | undefined,
      origin?: string,
    ): Promise<ChatMessage> {
      const row = await loadMessage(messageId);
      await requireTripRole(db, row.tripId, userId, 'viewer');
      if (row.senderId !== userId) throw forbidden('You can only edit your own messages');
      if (row.kind !== 'text') throw badRequest('Only text messages can be edited');
      if (Date.now() - row.createdAt.getTime() > MESSAGE_EDIT_WINDOW_MS) {
        throw forbidden('Messages can only be edited for 24 hours after sending');
      }

      // Mentions stay as they were unless the edit says who it mentions now.
      const before = (row.payload as { mentions?: string[]; preview?: unknown } | null) ?? {};
      const mentions = mentionIds === undefined ? (before.mentions ?? []) : await validMentions(row.tripId, userId, mentionIds);
      // A different link needs a new preview; the old one would describe the wrong page.
      const linkChanged = firstUrl(body) !== firstUrl(row.body);
      const { preview } = before;
      const rest = Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'mentions' && k !== 'preview'));
      const payload = {
        ...rest,
        ...(mentions.length > 0 ? { mentions } : {}),
        ...(preview && !linkChanged ? { preview } : {}),
      };

      const [updated] = await db
        .update(messages)
        .set({ body, editedAt: new Date(), payload: Object.keys(payload).length > 0 ? payload : null })
        .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
        .returning();
      if (!updated) throw notFound('Message not found');
      await jobs.notifyMention(row.tripId, messageId, mentions.filter((id) => !(before.mentions ?? []).includes(id)));
      if (linkChanged && firstUrl(body)) await jobs.linkPreview(messageId);

      const [sender] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
      const quotes = await quotesFor(db, [updated.replyToId]);
      const message = toMessage(
        updated,
        sender?.name ?? null,
        (await reactionsFor([messageId], userId)).get(messageId) ?? [],
        null,
        await itemOfChannel(updated.channelId),
        updated.replyToId ? (quotes.get(updated.replyToId) ?? null) : null,
      );
      await publishTripEvent(redis, {
        type: 'message.updated',
        tripId: row.tripId,
        entityId: messageId,
        actorId: userId,
        payload: message,
        originClientId: origin,
      });
      return message;
    },

    /**
     * Deletes a message for everyone. The sender can always delete their own,
     * and a trip owner can delete anyone's. The text is wiped, not hidden; the
     * message stays as "Message deleted" so the conversation still reads right.
     */
    async remove(messageId: string, userId: string, origin?: string) {
      const row = await loadMessage(messageId, { includeDeleted: true });
      const role = await requireTripRole(db, row.tripId, userId, 'viewer');
      if (row.kind === 'system') throw forbidden('Activity cards can’t be deleted');
      if (row.senderId !== userId && role !== 'owner') {
        throw forbidden('Only the sender or a trip owner can delete this message');
      }
      if (row.deletedAt) return;

      await db
        .update(messages)
        .set({ deletedAt: new Date(), body: '', payload: null })
        .where(eq(messages.id, messageId));

      // Photos sent only in the chat go with it; ones also in the album stay there.
      const mediaIds = mediaIdsOf(row);
      if (mediaIds.length > 0) {
        const chatOnly = await db
          .update(photos)
          .set({ deletedAt: new Date(), version: sql`${photos.version} + 1` })
          .where(and(inArray(photos.id, mediaIds), eq(photos.source, 'chat'), isNull(photos.deletedAt)))
          .returning({ storageKey: photos.storageKey, thumbKey: photos.thumbKey });
        await Promise.all(
          chatOnly
            .flatMap((p) => [p.storageKey, p.thumbKey])
            .filter((k): k is string => !!k)
            .map((k) => storage.remove(k).catch(() => {})),
        );
      }
      await publishTripEvent(redis, {
        type: 'message.deleted',
        tripId: row.tripId,
        entityId: messageId,
        actorId: userId,
        payload: { messageId, itemId: await itemOfChannel(row.channelId) },
        originClientId: origin,
      });
    },
  };
};
