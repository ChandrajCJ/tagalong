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
  /** The plan item this option became, once someone added it to the plan. */
  itemId: z.string().uuid().nullable().default(null),
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

/** How many photos one chat message can carry. */
export const MAX_CHAT_IMAGES = 10;

/** A photo in a chat message, with short-lived links for this viewer. */
export const ChatImage = z.object({
  id: z.string().uuid(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** Null until the worker has made it; show `url` meanwhile. */
  thumbUrl: z.string().url().nullable(),
  url: z.string().url().nullable(),
  /** Also in the trip's album. */
  inAlbum: z.boolean(),
  /** A video plays in the viewer; its thumbnail is the poster frame. */
  kind: z.enum(['photo', 'video']).default('photo'),
  durationMs: z.number().int().nullable().default(null),
});
export type ChatImage = z.infer<typeof ChatImage>;

/** What a link in a message looks like, read from the page's own tags. */
export const LinkPreview = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  image: z.string().url().nullable(),
  siteName: z.string().nullable(),
});
export type LinkPreview = z.infer<typeof LinkPreview>;

export const ChatMessage = z.object({
  id: z.string().uuid(),
  tripId: z.string().uuid(),
  senderId: z.string().uuid().nullable(),
  senderName: z.string().nullable(),
  kind: z.enum(['text', 'system', 'poll', 'image']),
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
  /** Set once the sender edited it; the app says "edited". */
  editedAt: z.string().nullable().default(null),
  /** Set once it was deleted; the body and payload are gone, only the placeholder stays. */
  deletedAt: z.string().nullable().default(null),
  reactions: z.array(MessageReaction),
  /** Only on poll messages. */
  poll: Poll.nullable(),
  /** Only on image messages; the body is the caption. */
  images: z.array(ChatImage).default([]),
  /** The plan item whose thread this belongs to; null for the main chat. */
  itemId: z.string().uuid().nullable(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/**
 * How far each member has received and read, for the ticks. `lastReadAt` is
 * null when read receipts are off, theirs or yours.
 */
export const ReadState = z.object({
  userId: z.string().uuid(),
  lastReadAt: z.string().nullable(),
  lastDeliveredAt: z.string().nullable().default(null),
  /** They turned read receipts off, so their reads aren't shown (or waited for). */
  readHidden: z.boolean().default(false),
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

export const SendMessageInput = z
  .object({
    id: z.string().uuid().optional(),
    /** The text, or the caption when there are photos. */
    body: z.string().trim().max(4000).default(''),
    replyToId: z.string().uuid().optional(),
    /** Photos already uploaded to the trip (source "chat" or "album"). */
    mediaIds: z
      .array(z.string().uuid())
      .max(MAX_CHAT_IMAGES, `A message can carry up to ${MAX_CHAT_IMAGES} photos`)
      .default([]),
    /** People @mentioned; anyone not on the trip is dropped. */
    mentions: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((m) => m.body.length > 0 || m.mediaIds.length > 0, { message: 'Type a message', path: ['body'] });
export type SendMessageInput = z.input<typeof SendMessageInput>;

/** How long after sending a message its sender can still edit it. */
export const MESSAGE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export const EditMessageInput = z.object({
  body: z.string().trim().min(1, 'Type a message').max(4000),
  /** Who the edited text mentions; leave out to keep the original's. */
  mentions: z.array(z.string().uuid()).max(50).optional(),
});
export type EditMessageInput = z.input<typeof EditMessageInput>;

export const ToggleReactionInput = z.object({
  emoji: z.enum(REACTIONS),
});

export const MarkReadInput = z.object({
  messageId: z.string().uuid(),
});

/** "My phone has received up to this message." */
export const MarkDeliveredInput = z.object({
  upTo: z.string().uuid(),
});

/** Who has received and read one of my messages, for its Info sheet. */
export const MessageInfo = z.object({
  readBy: z.array(z.object({ userId: z.string().uuid(), displayName: z.string(), at: z.string() })),
  deliveredTo: z.array(z.object({ userId: z.string().uuid(), displayName: z.string(), at: z.string().nullable() })),
  notDelivered: z.array(z.object({ userId: z.string().uuid(), displayName: z.string() })),
  /** False when your own read receipts are off: then nobody's reads are shown. */
  readsShown: z.boolean(),
});
export type MessageInfo = z.infer<typeof MessageInfo>;

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

/** Puts a poll option on the plan, on a day or with no day yet. */
export const AddPollOptionToPlanInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable(),
});
export type AddPollOptionToPlanInput = z.input<typeof AddPollOptionToPlanInput>;

/** The options this person is picking now. An empty list clears their vote. */
export const VotePollInput = z.object({
  optionIds: z.array(z.string().uuid()).max(6),
});
export type VotePollInput = z.input<typeof VotePollInput>;

export const RegisterPushTokenInput = z.object({
  token: z.string().min(10).max(200),
  platform: z.enum(['ios', 'android', 'web']),
});
