/**
 * Wall-clock time in a named timezone, without a date library. Lives here
 * rather than in the app so it's covered by tests: off-by-an-hour bugs around
 * daylight saving are exactly the kind nobody notices until the airport.
 */

/** The phone's own timezone, used for new bookings. */
export const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Falls back to the phone's zone if a stored one isn't recognised. */
export const safeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return deviceTimezone();
  }
};

const partsIn = (at: Date, tz: string) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: safeZone(tz),
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

/** How many minutes `tz` is ahead of UTC at the moment `at`. */
const offsetMinutes = (at: Date, tz: string) => {
  const p = partsIn(at, tz);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return (asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000;
};

/**
 * "2026-06-12" + "08:15" in "Europe/Lisbon" → the real instant, as ISO.
 * Done by hand to avoid a date library: guess as if UTC, then correct by the
 * zone's offset. The second pass settles the hour around a DST change.
 */
export const toInstant = (date: string, time: string, tz: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y!, m! - 1, d!, hh!, mm!);
  const first = guess - offsetMinutes(new Date(guess), tz) * 60_000;
  const settled = guess - offsetMinutes(new Date(first), tz) * 60_000;
  return new Date(settled).toISOString();
};

/** The other way: an instant shown as the date and time on a wall clock in `tz`. */
export const wallClock = (iso: string, tz: string) => {
  const p = partsIn(new Date(iso), tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
};
