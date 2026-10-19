import { MESSAGE_EDIT_WINDOW_MS, type ChatMessage, type ReadState } from '@tagalong/shared';

/** A message as the screen holds it: sending ones are shown before the server confirms. */
export type LocalMessage = ChatMessage & {
  status?: 'sending' | 'failed';
  /** Photos still on this phone, shown while they upload. */
  localUris?: { uri: string; video: boolean }[];
};

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

/** Applies someone's newer read or delivery marker; markers never move back. */
export const mergeReadState = (states: ReadState[], update: Partial<ReadState> & { userId: string }): ReadState[] => {
  const current = states.find((r) => r.userId === update.userId);
  const later = (a: string | null | undefined, b: string | null | undefined) => (!a ? (b ?? null) : !b ? a : a > b ? a : b);
  const next: ReadState = {
    userId: update.userId,
    lastReadAt: update.readHidden ? null : later(current?.lastReadAt, update.lastReadAt),
    lastDeliveredAt: later(current?.lastDeliveredAt, update.lastDeliveredAt),
    readHidden: update.readHidden ?? current?.readHidden ?? false,
  };
  return [...states.filter((r) => r.userId !== update.userId), next];
};

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

/**
 * Someone edited a message, or its link preview arrived: take the new text
 * and payload, keep our own reactions and status.
 */
export const applyEdit = (messages: LocalMessage[], edited: ChatMessage): LocalMessage[] =>
  messages.map((m) =>
    m.id === edited.id
      ? { ...m, body: edited.body, editedAt: edited.editedAt, payload: edited.payload }
      : m.replyTo?.id === edited.id && !m.replyTo.deleted
        ? { ...m, replyTo: { ...m.replyTo, body: edited.body.slice(0, 140) } }
        : m,
  );

/** A message was deleted: it becomes a placeholder, and replies quoting it say so. */
export const applyDelete = (messages: LocalMessage[], messageId: string): LocalMessage[] =>
  messages.map((m) =>
    m.id === messageId
      ? { ...m, body: '', payload: null, poll: null, reactions: [], replyTo: null, deletedAt: m.deletedAt ?? new Date().toISOString() }
      : m.replyTo?.id === messageId
        ? { ...m, replyTo: { ...m.replyTo, body: '', deleted: true } }
        : m,
  );

/** Whether I can still fix this message: my own text, sent, and under a day old. */
export const canEditMessage = (m: LocalMessage, me: string | undefined, now = Date.now()) =>
  !!me &&
  m.senderId === me &&
  m.kind === 'text' &&
  !m.status &&
  !m.deletedAt &&
  now - new Date(m.createdAt).getTime() < MESSAGE_EDIT_WINDOW_MS;
