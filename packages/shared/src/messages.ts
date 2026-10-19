import type { ReadState } from './schemas/chat';

export interface Person {
  userId: string;
  displayName: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits a message into plain text and @mentions of these people, so the app
 * can highlight them. Longer names win, so "@Sam Lee" isn't read as "@Sam".
 */
export const mentionSegments = (body: string, people: Person[]): { text: string; userId: string | null }[] => {
  const named = people.filter((p) => p.displayName.trim()).sort((a, b) => b.displayName.length - a.displayName.length);
  if (named.length === 0 || !body.includes('@')) return [{ text: body, userId: null }];
  const pattern = new RegExp(`@(${named.map((p) => escape(p.displayName)).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  const segments: { text: string; userId: string | null }[] = [];
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) segments.push({ text: body.slice(last, at), userId: null });
    const person = named.find((p) => p.displayName === match[1])!;
    segments.push({ text: match[0], userId: person.userId });
    last = at + match[0].length;
  }
  if (last < body.length) segments.push({ text: body.slice(last), userId: null });
  return segments;
};

/** The people whose "@Name" is still in the text, of those picked while typing. */
export const mentionedIn = (body: string, people: Person[]) => {
  const ids = new Set(mentionSegments(body, people).flatMap((s) => (s.userId ? [s.userId] : [])));
  return people.filter((p) => ids.has(p.userId)).map((p) => p.userId);
};

/** The name being typed after "@" at the end of a draft, or null when not mentioning. */
export const mentionQuery = (draft: string): string | null => {
  const match = /(?:^|\s)@([^\s@]{0,30})$/u.exec(draft);
  return match ? match[1]! : null;
};

/** Replaces the "@pa" being typed with "@Priya ". */
export const insertMention = (draft: string, name: string) => draft.replace(/@([^\s@]{0,30})$/u, `@${name} `);

export type Ticks = 'sent' | 'delivered' | 'read';

/**
 * WhatsApp-style ticks for one of my messages: delivered once every member who
 * was on the trip when it was sent has received it, read once they've all read
 * it. People who hide their reads count once delivered; if I hide mine, I see
 * nobody's, so it stops at delivered.
 */
export const messageTicks = (
  message: { createdAt: string; senderId: string | null },
  members: { userId: string; joinedAt: string | null }[],
  readStates: ReadState[],
  readsShown: boolean,
): Ticks => {
  const others = members.filter(
    (m) => m.userId !== message.senderId && (!m.joinedAt || m.joinedAt <= message.createdAt),
  );
  if (others.length === 0) return 'sent';
  const states = others.map((m) => readStates.find((r) => r.userId === m.userId));
  const reached = (at: string | null | undefined) => !!at && at >= message.createdAt;
  const delivered = states.every((r) => !!r && (reached(r.lastDeliveredAt) || reached(r.lastReadAt)));
  if (!delivered) return 'sent';
  const visible = states.filter((r) => !r!.readHidden);
  const read = readsShown && visible.length > 0 && visible.every((r) => reached(r!.lastReadAt));
  return read ? 'read' : 'delivered';
};
