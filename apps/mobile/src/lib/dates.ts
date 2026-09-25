// Calendar dates as 'YYYY-MM-DD' strings. They sort correctly as plain strings
// and avoid time-zone surprises, since a trip day is a local calendar day.

const pad = (n: number) => String(n).padStart(2, '0');

export const toIso = (year: number, month: number, day: number) =>
  `${year}-${pad(month + 1)}-${pad(day)}`;

export const todayIso = (now = new Date()) =>
  toIso(now.getFullYear(), now.getMonth(), now.getDate());

export const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Day of the week for the 1st of the month, 0 = Monday. */
export const firstWeekday = (year: number, month: number) =>
  (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;

export const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y ?? 1970, month: (m ?? 1) - 1, day: d ?? 1 };
};

export const nightsBetween = (start: string, end: string) => {
  const a = parseIso(start);
  const b = parseIso(end);
  return Math.round(
    (Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / 86_400_000,
  );
};

export interface DateRange {
  start: string | null;
  end: string | null;
}

/**
 * What a tap on `day` does: the first tap picks the start, the second picks
 * the end. Tapping before the start, or after a full range, starts over.
 */
export const applyDayTap = ({ start, end }: DateRange, day: string): DateRange => {
  if (!start || end || day < start) return { start: day, end: null };
  return { start, end: day };
};

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Friday, June 12, 2027", for screen readers. */
export const spokenDate = (iso: string) => {
  const { year, month, day } = parseIso(iso);
  const weekday = WEEKDAYS_LONG[(new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7];
  return `${weekday}, ${MONTH_NAMES[month]} ${day}, ${year}`;
};
