/**
 * Which photos belong to a plan item: the ones taken during it.
 *
 * Both sides are wall-clock times where things happened (a plan item's date
 * and time; a photo's EXIF time), so they compare directly, with no timezone
 * maths. Only items with a start time get photos: an all-day item would claim
 * every photo of that day, including the ones from the item before it.
 */

/** How long an item with a start but no end is assumed to last. */
export const DEFAULT_ITEM_HOURS = 3;

export interface PhotoWindow {
  /** Inclusive bounds, "2026-06-12T18:30:00", comparable as plain strings. */
  from: string;
  to: string;
}

const addMinutes = (date: string, time: string, minutes: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const at = new Date(Date.UTC(y!, m! - 1, d!, hh!, mm! + minutes));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:00`;
};

export const photoWindow = (item: {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
}): PhotoWindow | null => {
  if (!item.date || !item.startTime) return null;
  const from = `${item.date}T${item.startTime}:00`;

  let end: string;
  if (!item.endTime) {
    end = addMinutes(item.date, item.startTime, DEFAULT_ITEM_HOURS * 60);
  } else if (item.endTime <= item.startTime) {
    // An end before the start means it runs past midnight: fado from 22:00 to 01:00.
    end = addMinutes(item.date, item.endTime, 24 * 60);
  } else {
    end = `${item.date}T${item.endTime}:00`;
  }
  // The last minute counts too: a photo at 21:00:40 belongs to something ending at 21:00.
  return { from, to: end.replace(/:00$/, ':59') };
};

/** "2026-06-12T18:30" → "2026-06-12T18:30:00", so it compares correctly as text. */
const withSeconds = (t: string) => (t.length === 16 ? `${t}:00` : t);

/** Whether a photo taken at `takenAt` falls inside the window. */
export const inWindow = (takenAt: string | null, window: PhotoWindow | null) => {
  if (!takenAt || !window) return false;
  const t = withSeconds(takenAt);
  return t >= window.from && t <= window.to;
};
