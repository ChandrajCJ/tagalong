import { LOCATION_STALE_MS } from './schemas/location';
import { toInstant, wallClock } from './zoned-time';

export const SHARE_CHOICES = ['1h', '4h', 'today'] as const;
export type ShareChoice = (typeof SHARE_CHOICES)[number];

/**
 * When sharing stops for a choice: an hour or four from now, or the end of
 * today on the person's own clock (an hour from now if today is nearly over).
 */
export const shareUntil = (choice: ShareChoice, now: Date, tz: string) => {
  const later = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  if (choice === '1h') return later(1);
  if (choice === '4h') return later(4);
  const endOfDay = toInstant(wallClock(now.toISOString(), tz).date, '23:59', tz);
  return Date.parse(endOfDay) - now.getTime() < 3_600_000 ? later(1) : endOfDay;
};

/** "2 h left", "25 min left", "1 min left". */
export const timeLeft = (until: string, now: Date) => {
  const minutes = Math.max(1, Math.ceil((Date.parse(until) - now.getTime()) / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 >= 30 ? ' 30 min' : ''} left` : `${minutes} min left`;
};

/** "just now", "3 min ago", "2 h ago", and whether it's old enough to fade. */
export const freshness = (at: string, now: Date) => {
  const ms = now.getTime() - Date.parse(at);
  const minutes = Math.floor(ms / 60_000);
  const label = minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
  return { label, stale: ms > LOCATION_STALE_MS };
};
