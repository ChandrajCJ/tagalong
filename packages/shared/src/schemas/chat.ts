import { z } from 'zod';

/** The reactions the app offers. The server accepts only these. */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '🎉'] as const;

export const MessageReaction = z.object({
  emoji: z.string(),
  count: z.number().int(),
  mine: z.boolean(),
});

export const ChatMessage = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  senderId: z.string().uuid().nullable(),
  senderName: z.string().nullable(),
  kind: z.enum(['text', 'system']),
  body: z.string(),
  replyToId: z.string().uuid().nullable(),
  /** For system messages: what happened, e.g. { event: 'member_joined', userId }. */
  payload: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  reactions: z.array(MessageReaction),
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

export const RegisterPushTokenInput = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android', 'web']),
});
