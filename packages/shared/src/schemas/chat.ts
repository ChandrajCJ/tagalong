import { z } from 'zod';

/** The reactions the app offers. The server accepts only these. */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '🎉'] as const;

export const MessageReaction = z.object({
  emoji: z.string(),
  count: z.number().int(),
  mine: z.boolean(),
});

export const PollOption = z.object({
  id: z.string().uuid(),
  label: z.string(),
  votes: z.number().int(),
  /** Who picked this one, so the poll can show faces. */
  voters: z.array(z.object({ userId: z.string().uuid(), displayName: z.string() })),
  mine: z.boolean(),
});
export type PollOption = z.infer<typeof PollOption>;

export const Poll = z.object({
  id: z.string().uuid(),
  question: z.string(),
  /** Whether people may pick more than one option. */
  multi: z.boolean(),
  closedAt: z.string().nullable(),
  createdBy: z.string().uuid(),
  options: z.array(PollOption),
  /** How many people voted at all, for "4 of 6 voted". */
  voterCount: z.number().int(),
});
export type Poll = z.infer<typeof Poll>;

export const ChatMessage = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  senderId: z.string().uuid().nullable(),
  senderName: z.string().nullable(),
  kind: z.enum(['text', 'system', 'poll']),
  body: z.string(),
  replyToId: z.string().uuid().nullable(),
  /** A short preview of the message this answers, shown above the reply. */
  replyTo: z
    .object({
      id: z.string().uuid(),
      senderName: z.string().nullable(),
      body: z.string(),
      /** The original was deleted; the reply still says what it answered. */
      deleted: z.boolean(),
    })
    .nullable()
    .default(null),
  /** For system messages: what happened, e.g. { event: 'member_joined', userId }. */
  payload: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  reactions: z.array(MessageReaction),
  /** Only on poll messages. */
  poll: Poll.nullable(),
  /** The plan item whose thread this belongs to; null for the main chat. */
  itemId: z.string().uuid().nullable(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** How far each member has read, for "Seen by". */
export const ReadState = z.object({
  userId: z.string().uuid(),
  lastReadAt: z.string(),
});
export type ReadState = z.infer<typeof ReadState>;

export const MessagePage = z.object({
  /** Newest first. */
  messages: z.array(ChatMessage),
  /** Pass as `before` to load older messages; null when there are none. */
  nextCursor: z.string().nullable(),
  readStates: z.array(ReadState),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const SendMessageInput = z.object({
  id: z.string().uuid().optional(),
  body: z.string().trim().min(1, 'Type a message').max(4000),
  replyToId: z.string().uuid().optional(),
});
export type SendMessageInput = z.input<typeof SendMessageInput>;

export const ToggleReactionInput = z.object({
  emoji: z.enum(REACTIONS),
});

export const MarkReadInput = z.object({
  messageId: z.string().uuid(),
});

export const CreatePollInput = z.object({
  id: z.string().uuid().optional(),
  question: z.string().trim().min(1, 'Ask a question').max(200),
  options: z
    .array(z.string().trim().min(1, 'Fill in every option').max(100))
    .min(2, 'Give at least two options')
    .max(6, 'Six options is the most a poll can have'),
  multi: z.boolean().default(false),
});
export type CreatePollInput = z.input<typeof CreatePollInput>;

/** The options this person is picking now. An empty list clears their vote. */
export const VotePollInput = z.object({
  optionIds: z.array(z.string().uuid()).max(6),
});
export type VotePollInput = z.input<typeof VotePollInput>;

export const RegisterPushTokenInput = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android', 'web']),
});
