const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { y: y ?? 0, m: (m ?? 1) - 1, d: d ?? 1 };
};

/** "Jun 12–16", "Jun 28 – Jul 3", or "Dates not set". */
export const formatDateRange = (start: string | null, end: string | null) => {
  if (!start) return 'Dates not set';
  const s = parts(start);
  if (!end || end === start) return `${MONTHS[s.m]} ${s.d}`;
  const e = parts(end);
  if (s.m === e.m && s.y === e.y) return `${MONTHS[s.m]} ${s.d}–${e.d}`;
  return `${MONTHS[s.m]} ${s.d} – ${MONTHS[e.m]} ${e.d}`;
};

/** "In 23 days", "Happening now", "Past", or null when there are no dates. */
export const tripCountdown = (start: string | null, end: string | null, today = new Date()) => {
  if (!start) return null;
  const day = (iso: string) => {
    const p = parts(iso);
    return Date.UTC(p.y, p.m, p.d);
  };
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((day(start) - now) / 86_400_000);
  if (days > 1) return `In ${days} days`;
  if (days === 1) return 'Tomorrow';
  if (now <= day(end ?? start)) return 'Happening now';
  return 'Past';
};
