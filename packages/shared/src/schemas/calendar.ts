import { z } from 'zod';

/** My calendar link (Profile → Calendar): whether it's on, and what it includes. */
export const CalendarFeed = z.object({
  active: z.boolean(),
  /** Stops without a time show as all-day items. */
  includeUntimed: z.boolean(),
  createdAt: z.string().nullable(),
  /** The last time a calendar app read it. */
  lastFetchedAt: z.string().nullable(),
});
export type CalendarFeed = z.infer<typeof CalendarFeed>;

/** A new link: the token is shown this once; only its hash is kept. */
export const NewCalendarFeed = CalendarFeed.extend({ token: z.string() });
export type NewCalendarFeed = z.infer<typeof NewCalendarFeed>;

export const UpdateCalendarFeedInput = z.object({ includeUntimed: z.boolean() });

/** The address a calendar subscribes to, from the API's own address. */
export const calendarFeedUrl = (apiUrl: string, token: string) => `${apiUrl.replace(/\/$/, '')}/calendar/${token}.ics`;
/** The same, as a webcal:// link Apple Calendar (and most others) open as a subscription. */
export const webcalUrl = (feedUrl: string) => feedUrl.replace(/^https?:\/\//, 'webcal://');
/** Google Calendar's "add by URL" page, with the feed filled in. */
export const googleCalendarUrl = (feedUrl: string) =>
  `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl(feedUrl))}`;
