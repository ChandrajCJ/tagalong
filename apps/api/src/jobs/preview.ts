import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { channels, messages, users, type Db } from '@tagalong/db';
import type { LinkPreview } from '@tagalong/shared';
import type { Redis } from 'ioredis';
import { publishTripEvent } from '../lib/events';
import type { LinkPreviewJob } from '../lib/jobs';
import { firstUrl, parsePreview, safeFetch, type FetchOptions } from '../lib/link-preview';
import { quotesFor, toMessage } from '../modules/chat/channel';

/** A page's preview is reused for a week; a page with none is tried again after an hour. */
const CACHE_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;

export const previewCacheKey = (url: string) => `preview:${createHash('sha256').update(url).digest('hex')}`;

export type PreviewResult =
  | { skipped: 'gone' | 'no_link' | 'own_app' | 'changed' | 'no_preview' }
  | { added: LinkPreview; cached: boolean };

/**
 * Reads the first link in a message and attaches its title, description and
 * picture, then tells everyone so the card appears. Links to the app itself
 * (invites) get no card: the message already says what they are.
 */
export const processLinkPreview = async (
  deps: { db: Db; redis: Redis; ownHosts?: string[]; fetchOptions?: FetchOptions },
  { messageId }: LinkPreviewJob,
): Promise<PreviewResult> => {
  const { db, redis } = deps;
  const load = async () =>
    (
      await db
        .select()
        .from(messages)
        .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
    )[0];

  const row = await load();
  if (!row || row.kind !== 'text') return { skipped: 'gone' };
  const url = firstUrl(row.body);
  if (!url) return { skipped: 'no_link' };
  const host = new URL(url).hostname.toLowerCase();
  if ((deps.ownHosts ?? []).includes(host)) return { skipped: 'own_app' };

  const key = previewCacheKey(url);
  const cachedRaw = await redis.get(key);
  let preview: LinkPreview | null;
  let cached = false;
  if (cachedRaw !== null) {
    preview = cachedRaw === 'none' ? null : (JSON.parse(cachedRaw) as LinkPreview);
    cached = true;
  } else {
    try {
      const page = await safeFetch(url, deps.fetchOptions);
      const parsed = parsePreview(page.body.toString('utf8'), page.url);
      // The card links to what was typed; the page's own address only resolves its picture.
      preview = parsed ? { ...parsed, url } : null;
    } catch {
      preview = null;
    }
    if (preview) await redis.set(key, JSON.stringify(preview), 'EX', CACHE_SECONDS);
    else await redis.set(key, 'none', 'EX', MISS_SECONDS);
  }
  if (!preview) return { skipped: 'no_preview' };

  // It may have been edited (or deleted) while we fetched.
  const current = await load();
  if (!current || firstUrl(current.body) !== url) return { skipped: 'changed' };
  const payload = { ...((current.payload as Record<string, unknown> | null) ?? {}), preview };
  const [updated] = await db.update(messages).set({ payload }).where(eq(messages.id, messageId)).returning();

  const [sender] = current.senderId
    ? await db.select({ name: users.displayName }).from(users).where(eq(users.id, current.senderId))
    : [];
  const [channel] = await db.select({ itemId: channels.itemId }).from(channels).where(eq(channels.id, current.channelId));
  const quotes = await quotesFor(db, [current.replyToId]);
  const message = toMessage(
    updated!,
    sender?.name ?? null,
    [],
    null,
    channel?.itemId ?? null,
    current.replyToId ? (quotes.get(current.replyToId) ?? null) : null,
  );
  await publishTripEvent(redis, {
    type: 'message.updated',
    tripId: current.tripId,
    entityId: messageId,
    actorId: current.senderId ?? messageId,
    payload: message,
  });
  return { added: preview, cached };
};
