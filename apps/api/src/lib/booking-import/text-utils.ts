/**
 * Small readers for the messy text of confirmation emails: HTML to plain
 * text, and dates, times and amounts in the ways Indian, UK and US
 * senders write them.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rarr: '→',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  euro: '€',
  pound: '£',
  rupee: '₹',
};

export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

/** An email's HTML as readable lines: table cells become " | ", blocks become new lines. */
export const htmlToText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').replace(/(\s*\|\s*)+$/, '').trim())
    .filter(Boolean)
    .join('\n');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

const MONTH = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_PATTERNS: { re: RegExp; read: (m: RegExpExecArray, year: number) => string | null }[] = [
  // 2026-06-12
  { re: /\b(20\d\d)-(\d\d)-(\d\d)\b/g, read: (m) => iso(+m[1]!, +m[2]!, +m[3]!) },
  // 12 Jun 2026, 12-Jun-26, 12th June, 2026, Thu 12 Jun
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${MONTH}(?:[\\s,-]+'?(\\d{4}|\\d{2})(?!:))?\\b`, 'gi'),
    read: (m, year) => iso(m[3] ? fullYear(m[3]) : year, MONTHS.indexOf(m[2]!.slice(0, 3).toLowerCase()) + 1, +m[1]!),
  },
  // June 12, 2026 / Jun 12
  {
    re: new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'),
    read: (m, year) => iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1, +m[2]!),
  },
  // 12/06/2026 or 12.06.2026: day first (India, UK), unless that can't be right.
  {
    re: /\b(\d{1,2})[/.](\d{1,2})[/.](20\d\d|\d\d)\b/g,
    read: (m) => {
      const [a, b, y] = [+m[1]!, +m[2]!, fullYear(m[3]!)];
      return b > 12 ? iso(y, a, b) : iso(y, b, a);
    },
  },
];

export interface Found<T> {
  value: T;
  index: number;
}

/** Every date in the text, in order, as YYYY-MM-DD. A missing year is `year`. */
export const findDates = (text: string, year: number): Found<string>[] => {
  const out: Found<string>[] = [];
  for (const { re, read } of DATE_PATTERNS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const value = read(m, year);
      // Patterns can overlap ("12 Jun 2026" and "Jun 2026"); keep the first reading of a spot.
      if (value && !out.some((d) => Math.abs(d.index - m!.index) < 4)) out.push({ value, index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
};

/** Every clock time in the text, as "HH:MM" (24-hour). */
export const findTimes = (text: string): Found<string>[] => {
  const out: Found<string>[] = [];
  const re = /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.|hrs|h)?(?![\d.:])/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let h = +m[1]!;
    const suffix = m[3]?.toLowerCase().replace(/\./g, '');
    // "12.50" with no suffix after a currency sign is money, not a time.
    if (!suffix && /[₹$€£]\s*$|(rs|inr|usd|eur|gbp)\s*$/i.test(text.slice(Math.max(0, m.index - 5), m.index))) continue;
    if (suffix === 'pm' && h < 12) h += 12;
    if (suffix === 'am' && h === 12) h = 0;
    out.push({ value: `${pad(h)}:${m[2]}`, index: m.index });
  }
  return out;
};

const CURRENCY: Record<string, string> = { '₹': 'INR', rs: 'INR', 'rs.': 'INR', inr: 'INR', $: 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR', '£': 'GBP', gbp: 'GBP' };

/** The total paid, from a line that says so: "Total ₹4,520", "Grand total: INR 4520.00". */
export const findTotal = (text: string): { minor: number; currency: string } | null => {
  const label = '(?:grand total|total amount|amount paid|total paid|total fare|total price|total charged|total)';
  const cur = '(₹|rs\\.?|inr|\\$|usd|€|eur|£|gbp)';
  const amount = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
  const before = new RegExp(`${label}[^\\n\\d₹$€£]{0,25}${cur}\\s?${amount}`, 'i');
  const after = new RegExp(`${label}[^\\n\\d₹$€£]{0,25}${amount}\\s?${cur}`, 'i');
  const m = before.exec(text);
  const n = m ? null : after.exec(text);
  const [currencyRaw, amountRaw] = m ? [m[1]!, m[2]!] : n ? [n[2]!, n[1]!] : [null, null];
  if (!currencyRaw || !amountRaw) return null;
  const currency = CURRENCY[currencyRaw.toLowerCase()];
  const value = Number(amountRaw.replace(/,/g, ''));
  return currency && Number.isFinite(value) ? { minor: Math.round(value * 100), currency } : null;
};

/** Reads an amount like 4520, "4,520.00" or "4.520,00" given with schema.org's price. */
export const toMinor = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[^\d.,]/g, '');
  const normal = /,\d{2}$/.test(clean) ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  const n = Number(normal);
  return clean && Number.isFinite(n) ? Math.round(n * 100) : null;
};
