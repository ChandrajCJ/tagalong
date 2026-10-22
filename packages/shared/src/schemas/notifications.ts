import { z } from 'zod';

/** What can send a push. Each can be turned off, everywhere or for one trip. */
export const NOTIFICATION_KINDS = ['chat', 'mentions', 'plan', 'money', 'todos', 'trip', 'countdown', 'journal', 'memories'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** How long before a timed stop its reminder goes off, in minutes. */
export const REMINDER_LEADS = [15, 30, 60, 120] as const;
export const DEFAULT_REMINDER_MINUTES = 30;
/** Flights need longer: getting to the airport. */
export const FLIGHT_REMINDER_MINUTES = 180;

/** When the evening journal prompt can come, on the trip's clock. */
export const JOURNAL_TIMES = ['19:30', '20:30', '21:30'] as const;
export const DEFAULT_JOURNAL_TIME = '20:30';

/** Settings with every value filled in: the defaults, or what applies on one trip. */
export const NotificationPrefs = z.object({
  chat: z.boolean(),
  mentions: z.boolean(),
  plan: z.boolean(),
  money: z.boolean(),
  todos: z.boolean(),
  trip: z.boolean(),
  /** "A week to Goa!", "Tomorrow: Goa · 4 items to pack": the countdown before a trip. */
  countdown: z.boolean().default(true),
  /** "Day 2 in Goa: what was the best moment?" in the evening, during a trip. */
  journal: z.boolean().default(true),
  /** "A year ago today you were in Goa", and "Your Goa recap is ready". */
  memories: z.boolean().default(true),
  /** When the evening prompt comes, on the trip's clock. */
  journalTime: z.enum(JOURNAL_TIMES).default(DEFAULT_JOURNAL_TIME),
  /** Reminders before timed stops, set on the phone. */
  reminders: z.boolean(),
  reminderMinutes: z.number().int(),
  /** Nothing but @mentions until then; far in the future means "until I turn it back on". */
  mutedUntil: z.string().nullable(),
});
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;

export const DEFAULT_PREFS: NotificationPrefs = {
  chat: true,
  mentions: true,
  plan: true,
  money: true,
  todos: true,
  trip: true,
  countdown: true,
  journal: true,
  memories: true,
  journalTime: DEFAULT_JOURNAL_TIME,
  reminders: true,
  reminderMinutes: DEFAULT_REMINDER_MINUTES,
  mutedUntil: null,
};

const toggle = z.boolean();
const lead = z
  .number()
  .int()
  .refine((n) => (REMINDER_LEADS as readonly number[]).includes(n), 'Pick 15, 30, 60 or 120 minutes');

/** Changes to the defaults (Profile → Notifications). */
export const UpdateNotificationPrefsInput = z.object({
  chat: toggle.optional(),
  mentions: toggle.optional(),
  plan: toggle.optional(),
  money: toggle.optional(),
  todos: toggle.optional(),
  trip: toggle.optional(),
  countdown: toggle.optional(),
  journal: toggle.optional(),
  memories: toggle.optional(),
  journalTime: z.enum(JOURNAL_TIMES).optional(),
  reminders: toggle.optional(),
  reminderMinutes: lead.optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
});
export type UpdateNotificationPrefsInput = z.input<typeof UpdateNotificationPrefsInput>;

/** One trip's settings: null means "as my defaults". */
export const UpdateTripNotificationsInput = z.object({
  chat: toggle.nullable().optional(),
  mentions: toggle.nullable().optional(),
  plan: toggle.nullable().optional(),
  money: toggle.nullable().optional(),
  todos: toggle.nullable().optional(),
  trip: toggle.nullable().optional(),
  countdown: toggle.nullable().optional(),
  journal: toggle.nullable().optional(),
  memories: toggle.nullable().optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
});
export type UpdateTripNotificationsInput = z.input<typeof UpdateTripNotificationsInput>;

export const TripNotifications = z.object({
  /** What applies on this trip, defaults and overrides together. */
  effective: NotificationPrefs,
  /** What this trip sets itself; null follows the defaults. */
  overrides: z.object({
    chat: z.boolean().nullable(),
    mentions: z.boolean().nullable(),
    plan: z.boolean().nullable(),
    money: z.boolean().nullable(),
    todos: z.boolean().nullable(),
    trip: z.boolean().nullable(),
    countdown: z.boolean().nullable().default(null),
    journal: z.boolean().nullable().default(null),
    memories: z.boolean().nullable().default(null),
    mutedUntil: z.string().nullable(),
  }),
});
export type TripNotifications = z.infer<typeof TripNotifications>;

/** "Until I turn it back on": a date far enough away to mean forever. */
export const MUTED_FOREVER = '9999-01-01T00:00:00.000Z';

/** Android notification channels, so people can also tune them in system settings. */
export const PUSH_CHANNELS = {
  chat: { id: 'chat', name: 'Chat' },
  mentions: { id: 'mentions', name: 'Mentions' },
  activity: { id: 'activity', name: 'Plan & money' },
  reminders: { id: 'reminders', name: 'Reminders' },
} as const;

/** Which channel each kind of push goes out on. */
export const channelFor = (kind: NotificationKind | 'reminder') =>
  kind === 'chat'
    ? PUSH_CHANNELS.chat.id
    : kind === 'mentions'
      ? PUSH_CHANNELS.mentions.id
      : kind === 'reminder'
        ? PUSH_CHANNELS.reminders.id
        : PUSH_CHANNELS.activity.id;
