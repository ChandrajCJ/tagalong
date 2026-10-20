/**
 * A small iCalendar (RFC 5545) writer, so calendars can subscribe to the
 * plan without a library. Times on a place's clock carry their time zone,
 * with a VTIMEZONE describing its offsets over the years the events cover.
 */
import { offsetMinutes, safeZone } from './zoned-time';

/** When something happens: all day, on a place's clock, or at an exact instant. */
export type IcsTime =
  | { date: string }
  | { date: string; time: string; tz: string }
  | { instant: string };

export interface IcsEvent {
  /** Stable, so a calendar replaces the event when it changes: "item-<id>@tagalong". */
  uid: string;
  /** Goes up with each change; the row's version. */
  sequence: number;
  /** When it last changed. */
  stamp: string;
  summary: string;
  start: IcsTime;
  /** For an all-day item, the last day (inclusive); written as the day after, as the format wants. */
  end?: IcsTime | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

/** Text with its special characters escaped: backslash, semicolon, comma and line breaks. */
export const escapeText = (text: string) =>
  text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

/**
 * Splits a line longer than 75 bytes into continuation lines that start with
 * a space, never inside a character.
 */
export const foldLine = (line: string) => {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // The first line holds 75 bytes; the rest 74 after their leading space.
    if (bytes + size > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
};

const isZoned = (t: IcsTime | null | undefined): t is { date: string; time: string; tz: string } => !!t && 'time' in t;

const compactDate = (date: string) => date.replace(/-/g, '');
const compactUtc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const dayAfter = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const timeLine = (name: 'DTSTART' | 'DTEND', t: IcsTime, allDayEnd = false) => {
  if ('instant' in t) return `${name}:${compactUtc(t.instant)}`;
  if ('time' in t) return `${name};TZID=${safeZone(t.tz)}:${compactDate(t.date)}T${t.time.replace(':', '').slice(0, 4)}00`;
  return `${name};VALUE=DATE:${compactDate(allDayEnd ? dayAfter(t.date) : t.date)}`;
};

const offsetText = (minutes: number) => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
};

/** A floating local time ("19700101T000000") for an instant seen with an offset. */
const localStamp = (ms: number, offset: number) =>
  new Date(ms + offset * 60_000).toISOString().replace(/[-:]/g, '').slice(0, 15);

const HOUR = 3_600_000;

/**
 * The zone's offsets from `fromYear` to `toYear`: where it stood at the start,
 * and every change, found hour by hour and then pinned to the minute.
 */
export const zoneTransitions = (tz: string, fromYear: number, toYear: number) => {
  const start = Date.UTC(fromYear, 0, 1);
  const end = Date.UTC(toYear + 1, 0, 1);
  const at = (ms: number) => offsetMinutes(new Date(ms), tz);
  const changes: { at: number; from: number; to: number }[] = [];
  let before = at(start);
  // Checking every 6 hours is enough: no zone changes twice in that long.
  for (let t = start + 6 * HOUR; t <= end; t += 6 * HOUR) {
    const now = at(t);
    if (now === before) continue;
    let lo = t - 6 * HOUR;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (at(mid) === before) lo = mid;
      else hi = mid;
    }
    changes.push({ at: hi, from: before, to: now });
    before = now;
  }
  return { initial: at(start), start, changes };
};

/** The VTIMEZONE block for a zone over those years. */
export const vtimezone = (tz: string, fromYear: number, toYear: number) => {
  const zone = safeZone(tz);
  const { initial, start, changes } = zoneTransitions(zone, fromYear, toYear);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
  const observance = (kind: 'STANDARD' | 'DAYLIGHT', at: number, from: number, to: number) =>
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:${localStamp(at, from)}`,
      `TZOFFSETFROM:${offsetText(from)}`,
      `TZOFFSETTO:${offsetText(to)}`,
      `END:${kind}`,
    );
  const standard = Math.min(initial, ...changes.map((c) => c.to));
  observance(initial > standard ? 'DAYLIGHT' : 'STANDARD', start, initial, initial);
  for (const c of changes) observance(c.to > standard ? 'DAYLIGHT' : 'STANDARD', c.at, c.from, c.to);
  lines.push('END:VTIMEZONE');
  return lines;
};

/** A whole calendar: its name, a VTIMEZONE per zone used, then the events. Lines end in CRLF. */
export const icsCalendar = ({ name, events }: { name: string; events: IcsEvent[] }) => {
  const zones = new Map<string, { from: number; to: number }>();
  for (const e of events) {
    for (const t of [e.start, e.end].filter(isZoned)) {
      const zone = safeZone(t.tz);
      const year = Number(t.date.slice(0, 4));
      const seen = zones.get(zone);
      zones.set(zone, { from: Math.min(seen?.from ?? year, year), to: Math.max(seen?.to ?? year, year) });
    }
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tagalong//Trip plans//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    ...[...zones].flatMap(([zone, years]) => vtimezone(zone, years.from, years.to)),
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `SEQUENCE:${e.sequence}`,
      `DTSTAMP:${compactUtc(e.stamp)}`,
      timeLine('DTSTART', e.start),
      ...(e.end ? [timeLine('DTEND', e.end, !('time' in e.end) && !('instant' in e.end))] : []),
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
};
