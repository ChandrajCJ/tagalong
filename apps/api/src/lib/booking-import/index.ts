import { structuredBookings } from './structured';
import { textBookings } from './text';
import { htmlToText } from './text-utils';
import type { Candidate } from './types';

export { pdfText } from './pdf';
export type { Candidate, ParseContext } from './types';

/** At most this many bookings from one email; more is a newsletter, not a confirmation. */
const MAX_CANDIDATES = 8;

/**
 * The bookings in a confirmation email (or a pasted one, or a ticket PDF's
 * text). Structured data wins when there is any; otherwise the text is read
 * for the usual clues. Nothing here is saved: candidates are reviewed first.
 */
export const findBookings = (input: {
  html?: string | null;
  text?: string | null;
  /** When the email arrived, for dates written without a year. */
  receivedAt?: Date;
  /** The trip's time zone, for times written without one. */
  timezone?: string | null;
}): Candidate[] => {
  const ctx = { timezone: input.timezone || 'UTC', year: (input.receivedAt ?? new Date()).getUTCFullYear() };
  if (input.html) {
    const structured = structuredBookings(input.html, ctx);
    if (structured.length > 0) return structured.slice(0, MAX_CANDIDATES);
  }
  const text = [input.text, input.html ? htmlToText(input.html) : null].find((t) => t?.trim()) ?? '';
  // Pasted text can still be HTML (copied from a browser's source view).
  const plain = /<\/?(?:html|body|table|div|p|br)\b/i.test(text) ? htmlToText(text) : text;
  if (/<script[^>]*ld\+json/i.test(text)) {
    const structured = structuredBookings(text, ctx);
    if (structured.length > 0) return structured.slice(0, MAX_CANDIDATES);
  }
  return textBookings(plain, ctx).slice(0, MAX_CANDIDATES);
};
