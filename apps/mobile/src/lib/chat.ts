import type { ChatMessage, ReadState } from '@tagalong/shared';

/** A message as the screen holds it: sending ones are shown before the server confirms. */
export type LocalMessage = ChatMessage & { status?: 'sending' | 'failed' };

export type ChatRow =
  | { type: 'message'; key: string; message: LocalMessage; firstInGroup: boolean }
  | { type: 'day'; key: string; label: string };

const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const dayLabel = (iso: string, now = new Date()) => {
  const d = new Date(iso);
  const today = dayKey(now.toISOString());
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === today) return 'Today';
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Rows for an inverted list (newest first). A day separator follows the
 * oldest message of each day, so on screen it sits above that day's messages.
 */
export const buildRows = (messages: LocalMessage[]): ChatRow[] => {
  const rows: ChatRow[] = [];
  messages.forEach((m, i) => {
    const older = messages[i + 1];
    const sameDayAsOlder = older && dayKey(older.createdAt) === dayKey(m.createdAt);
    // First in a run of messages from the same person (reading top to bottom).
    const firstInGroup =
      !older || !sameDayAsOlder || older.kind !== 'text' || older.senderId !== m.senderId;
    rows.push({ type: 'message', key: m.id, message: m, firstInGroup });
    if (!sameDayAsOlder) rows.push({ type: 'day', key: `day-${dayKey(m.createdAt)}`, label: dayLabel(m.createdAt) });
  });
  return rows;
};

/** Newest first, no duplicates; a confirmed copy replaces a pending one. */
export const mergeMessages = (current: LocalMessage[], incoming: LocalMessage[]): LocalMessage[] => {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
  );
};

/** How many other members have read up to this message. */
export const seenCount = (message: ChatMessage, readStates: ReadState[], me: string) =>
  readStates.filter((r) => r.userId !== me && r.lastReadAt >= message.createdAt).length;

/** Applies someone else's reaction toggle to our copy of the message. */
export const applyReaction = (
  message: LocalMessage,
  emoji: string,
  added: boolean,
  byMe: boolean,
): LocalMessage => {
  const list = message.reactions.map((r) => ({ ...r }));
  const entry = list.find((r) => r.emoji === emoji);
  if (added) {
    if (entry) {
      entry.count += 1;
      entry.mine ||= byMe;
    } else list.push({ emoji, count: 1, mine: byMe });
  } else if (entry) {
    entry.count -= 1;
    if (byMe) entry.mine = false;
  }
  return { ...message, reactions: list.filter((r) => r.count > 0) };
};
