import { toInstant, type BookingType } from '@tagalong/shared';
import { AIRLINES, AIRPORTS } from './airports';
import { findDates, findTimes, findTotal, type Found } from './text-utils';
import type { Candidate, ParseContext } from './types';

/**
 * Guesses from the plain text of a confirmation (or of its PDF), for senders
 * that don't include structured data. Everything here is a guess, so
 * candidates are "medium" at best and always reviewed before they're added.
 */

const KEYWORDS: Record<BookingType, RegExp[]> = {
  flight: [/\bflight\b/i, /\bboarding\b/i, /\bairline\b/i, /\bdeparture\b/i, /\bterminal\b/i, /\bgate\b/i, /\bbaggage\b/i, /\bindigo\b|\bair india\b|\bvistara\b|\bspicejet\b|\bakasa\b/i, /\be-?ticket\b/i],
  train: [/\btrain\b/i, /\birctc\b/i, /\bcoach\b/i, /\bberth\b/i, /\brailways?\b/i, /\bquota\b/i, /\bboarding (?:at|station)\b/i, /\bpnr\b/i],
  stay: [/\bcheck-?\s?in\b/i, /\bcheck-?\s?out\b/i, /\bhotel\b/i, /\bnights?\b/i, /\bguests?\b/i, /\broom\b/i, /\bbooking\.com\b|\bairbnb\b|\bagoda\b|\bmakemytrip\b|\boyo\b/i, /\bstay\b/i],
  restaurant: [/\btable\b/i, /\brestaurant\b/i, /\bparty of\b/i, /\bdinner\b|\blunch\b|\bbrunch\b/i, /\bdining\b/i],
  car: [/\bcar rental\b|\brental car\b|\brent(?:ed|al)\b/i, /\bpick-?\s?up\b/i, /\bdrop-?\s?off\b/i, /\bvehicle\b/i, /\bzoomcar\b|\bhertz\b|\bavis\b|\beuropcar\b/i],
  ticket: [/\btickets?\b/i, /\bevent\b/i, /\bvenue\b/i, /\badmission\b|\bentry\b/i, /\bshow\b|\bconcert\b|\bmuseum\b/i, /\bbookmyshow\b|\bgetyourguide\b|\btiqets\b/i],
};

/** The kind of booking the text is about, or null if it doesn't read like one. */
export const detectType = (text: string): BookingType | null => {
  let best: BookingType | null = null;
  let bestScore = 1;
  for (const [type, words] of Object.entries(KEYWORDS) as [BookingType, RegExp[]][]) {
    let score = words.filter((w) => w.test(text)).length;
    if (type === 'flight' && flightNumbers(text).length > 0) score += 2;
    if (type === 'train' && /\bpnr\b[^\n\d]{0,15}\d{10}\b/i.test(text)) score += 2;
    if (score > bestScore) [best, bestScore] = [type, score];
  }
  return best;
};

const REFERENCE =
  /\b(?:pnr|booking\s*(?:ref(?:erence)?|code|id|no\.?|number)|confirmation\s*(?:code|number|no\.?|#)?|reservation\s*(?:code|number|no\.?|id)|ref(?:erence)?\s*(?:number|no\.?)?|itinerary\s*(?:number|no\.?))\s*(?:\(pnr\))?\s*(?:is)?\s*[:#)-]*\s*([A-Z0-9][A-Z0-9-]{4,15})\b/gi;

/** The booking reference or PNR: a code of capitals and digits after a label that says so. */
export const findReference = (text: string): string | null => {
  REFERENCE.lastIndex = 0;
  for (let m = REFERENCE.exec(text); m; m = REFERENCE.exec(text)) {
    const code = m[1]!;
    // Real codes are capitals and digits; "confirmed" or "details" are words.
    if (code === code.toUpperCase() && /\d|^[A-Z]{5,8}$/.test(code)) return code;
  }
  return null;
};

/** Flight numbers of airlines we know: "6E 2134", "AI-865", "TP1234". */
export const flightNumbers = (text: string): Found<string>[] => {
  const out: Found<string>[] = [];
  const re = /\b([A-Z0-9]{2})[\s-]?(\d{2,4})\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (AIRLINES[m[1]!] && /[A-Z]/.test(m[1]!)) out.push({ value: `${m[1]} ${m[2]}`, index: m.index });
  }
  return out;
};

const match = (text: string, re: RegExp) => re.exec(text)?.[1]?.trim() ?? null;
const clean = (s: string | null, max = 120) =>
  s
    ? s
        .replace(/\s*\|\s*$/, '')
        // "Sunny loft is confirmed" → "Sunny loft".
        .replace(/\s+(?:is|has been|was|are)\s+(?:now\s+)?(?:confirmed|booked|reserved)\b.*$/i, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max) || null
    : null;

/** The date and time nearest after `from` (within `reach` characters), as an instant in `tz`. */
const whenAfter = (text: string, from: number, ctx: ParseContext, tz: string, reach = 120) => {
  const window = text.slice(from, from + reach);
  const date = findDates(window, ctx.year)[0];
  if (!date) return null;
  const time = findTimes(window.slice(date.index))[0] ?? findTimes(window)[0];
  return toInstant(date.value, time?.value ?? '00:00', tz);
};

const labelIndex = (text: string, re: RegExp) => {
  const m = re.exec(text);
  return m ? m.index + m[0].length : -1;
};

type Draft = Candidate['booking'];

const finish = (booking: Draft, extraFound: string[] = []): Candidate | null => {
  const found = [
    ...Object.keys(booking.details),
    ...(['provider', 'reference', 'startsAt', 'endsAt', 'costMinor'] as const).filter((k) => booking[k] !== null),
    ...extraFound,
  ];
  // Without a reference or a date there's nothing to go on.
  if (!booking.reference && !booking.startsAt) return null;
  if (booking.startsAt && booking.endsAt && booking.endsAt < booking.startsAt) booking.endsAt = null;
  return { booking, confidence: booking.reference && booking.startsAt ? 'medium' : 'low', found };
};

const base = (type: BookingType, text: string, ctx: ParseContext): Draft => {
  const total = findTotal(text);
  return {
    type,
    provider: null,
    reference: findReference(text),
    startsAt: null,
    endsAt: null,
    timezone: ctx.timezone,
    details: {},
    costMinor: total?.minor ?? null,
    costCurrency: total?.currency ?? null,
  };
};

/** Flights: one candidate per flight number, so a return trip gives two. */
const flights = (text: string, ctx: ParseContext): Candidate[] => {
  const numbers = flightNumbers(text).filter((f, i, all) => all.findIndex((g) => g.value === f.value) === i);
  const segments = numbers.length > 0 ? numbers : [{ value: null, index: 0 }];
  const total = findTotal(text);
  return segments.flatMap((flight, i) => {
    // Dates often come just before the flight number in the same row.
    const start = Math.max(i > 0 ? segments[i - 1]!.index + 6 : 0, flight.index - 60);
    const end = segments[i + 1]?.index ?? text.length;
    const part = text.slice(start, end);
    const codes = [...part.matchAll(/\b([A-Z]{3})\b/g)].map((m) => m[1]!).filter((c) => AIRPORTS.has(c));
    const from = codes[0] ?? null;
    const to = codes.find((c) => c !== from) ?? null;
    const fromZone = (from && AIRPORTS.get(from)?.timezone) || ctx.timezone;
    const toZone = (to && AIRPORTS.get(to)?.timezone) || fromZone;
    const date = findDates(part, ctx.year)[0];
    // Times after the date: the part can reach back into the previous flight's row.
    const times = date ? findTimes(part.slice(date.index)) : [];
    const booking = base('flight', text, ctx);
    booking.timezone = fromZone;
    if (flight.value) {
      booking.details.flightNumber = flight.value;
      booking.provider = AIRLINES[flight.value.slice(0, 2)] ?? null;
    }
    if (from) booking.details.from = from;
    if (to) booking.details.to = to;
    const terminal = match(part, /\bterminal\s*[:-]?\s*(T?\d[A-Z]?)\b/i);
    if (terminal) booking.details.terminal = terminal.toUpperCase();
    const seats = match(part, /\bseats?(?:\s*no\.?)?\s*[:-]?\s*(\d{1,2}[A-K](?:\s*,\s*\d{1,2}[A-K])*)\b/i);
    if (seats) booking.details.seats = seats;
    if (date && times[0]) {
      booking.startsAt = toInstant(date.value, times[0].value, fromZone);
      if (times[1]) {
        // Landing "before" take-off means the next day.
        let arrival = toInstant(date.value, times[1].value, toZone);
        if (arrival < booking.startsAt) arrival = new Date(Date.parse(arrival) + 86_400_000).toISOString();
        booking.endsAt = arrival;
      }
    } else if (date) {
      booking.startsAt = toInstant(date.value, '00:00', fromZone);
    }
    // A total covers the whole trip: put it on the first flight only.
    if (i > 0 && total) [booking.costMinor, booking.costCurrency] = [null, null];
    return finish(booking) ?? [];
  });
};

const train = (text: string, ctx: ParseContext): Candidate | null => {
  const booking = base('train', text, ctx);
  booking.reference = match(text, /\bpnr\b[^\n\d]{0,15}(\d{10})\b/i) ?? booking.reference;
  if (/\birctc\b|\bindian railways?\b/i.test(text)) booking.provider = 'Indian Railways';
  const number = match(text, /\btrain\s*(?:no\.?|number|#)?\s*[:-]?\s*(\d{5})\b/i) ?? match(text, /\b(\d{5})\s*[/-]\s*[A-Z][A-Z ]{3,}/);
  if (number) booking.details.trainNumber = number;
  const from = clean(match(text, /\bfrom\s*[:-]\s*([^\n|]+?)(?=\s*(?:\||\n|\bto\s*[:-]))/i) ?? match(text, /\bboarding (?:at|station)\s*[:-]?\s*([^\n|]+)/i));
  const to = clean(match(text, /\bto\s*[:-]\s*([^\n|]+)/i));
  if (from) booking.details.from = from;
  if (to) booking.details.to = to;
  const coach = match(text, /\bcoach\s*(?:no\.?)?\s*[:-]?\s*([A-Z]{1,2}\d{1,2})\b/i);
  if (coach) booking.details.coach = coach.toUpperCase();
  const seats = clean(match(text, /\b(?:berth|seat)s?\s*(?:no\.?)?\s*[:-]?\s*(\d{1,3}(?:\s*[/,]\s*[A-Z0-9]+)*(?:\s+[A-Z]{2})?)\b/i), 40);
  if (seats) booking.details.seats = seats;
  const departs = labelIndex(text, /\b(?:departure|departs?|start(?:ing)? date|date of journey)\b/i);
  booking.startsAt = whenAfter(text, Math.max(departs, 0), ctx, ctx.timezone);
  const arrives = labelIndex(text, /\b(?:arrival|arrives?)\b/i);
  if (arrives >= 0) booking.endsAt = whenAfter(text, arrives, ctx, ctx.timezone, 60);
  return finish(booking);
};

const stay = (text: string, ctx: ParseContext): Candidate | null => {
  const booking = base('stay', text, ctx);
  booking.provider = clean(
    match(text, /\b(?:your (?:stay|booking|reservation) at|reservation at|booked at|you(?:'|’)re staying at)\s+([^\n|!.,]{3,80})/i) ??
      match(text, /^\s*(?:hotel|property|accommodation)\s*[:-]\s*([^\n|]{3,80})/im),
    100,
  );
  const address = clean(match(text, /\baddress\s*[:-]\s*([^\n]{5,250})/i), 300);
  if (address) booking.details.address = address;
  const phone = match(text, /\b(?:phone|tel|telephone|contact)\s*(?:no\.?)?\s*[:-]\s*(\+?[\d][\d ()-]{6,20}\d)/i);
  if (phone) booking.details.phone = phone;
  const room = clean(match(text, /\broom(?: type)?\s*[:-]\s*([^\n|]{3,80})/i), 100);
  if (room) booking.details.room = room;
  const checkIn = labelIndex(text, /\bcheck-?\s?in\b/i);
  const checkOut = labelIndex(text, /\bcheck-?\s?out\b/i);
  if (checkIn >= 0) booking.startsAt = whenAfter(text, checkIn, ctx, ctx.timezone, 60);
  if (checkOut >= 0) booking.endsAt = whenAfter(text, checkOut, ctx, ctx.timezone, 60);
  return finish(booking);
};

const restaurant = (text: string, ctx: ParseContext): Candidate | null => {
  const booking = base('restaurant', text, ctx);
  booking.provider = clean(match(text, /\b(?:table at|reservation at|booking at|booked at)\s+([^\n|!.,]{3,80})/i), 100);
  const party = match(text, /\bparty of\s*(\d{1,2})\b/i) ?? match(text, /\b(\d{1,2})\s*(?:guests|people|persons|pax|diners)\b/i);
  if (party) booking.details.partySize = Number(party);
  const address = clean(match(text, /\baddress\s*[:-]\s*([^\n]{5,250})/i), 300);
  if (address) booking.details.address = address;
  const date = findDates(text, ctx.year)[0];
  const time = date ? findTimes(text.slice(date.index))[0] ?? findTimes(text)[0] : null;
  if (date) booking.startsAt = toInstant(date.value, time?.value ?? '00:00', ctx.timezone);
  return finish(booking);
};

const car = (text: string, ctx: ParseContext): Candidate | null => {
  const booking = base('car', text, ctx);
  const pickup = labelIndex(text, /\bpick-?\s?up(?: location| date)?\b/i);
  const dropoff = labelIndex(text, /\bdrop-?\s?off(?: location| date)?\b|\breturn(?: location| date)?\b/i);
  const where = (from: number) => clean(match(text.slice(from), /^\s*[:-]?\s*([^\n|]{3,150})/), 200);
  const place = (s: string | null) => (s && !findDates(s, ctx.year).length ? s : null);
  if (pickup >= 0) {
    booking.details.pickup = place(where(pickup)) ?? '';
    booking.startsAt = whenAfter(text, pickup, ctx, ctx.timezone);
  }
  if (dropoff >= 0) {
    booking.details.dropoff = place(where(dropoff)) ?? '';
    booking.endsAt = whenAfter(text, dropoff, ctx, ctx.timezone);
  }
  for (const key of ['pickup', 'dropoff']) if (!booking.details[key]) delete booking.details[key];
  booking.provider = clean(match(text, /\b(zoomcar|hertz|avis|europcar|sixt|enterprise|myles|revv)\b/i), 60);
  return finish(booking);
};

const ticket = (text: string, ctx: ParseContext): Candidate | null => {
  const booking = base('ticket', text, ctx);
  booking.provider = clean(match(text, /\b(?:tickets? for|event|show)\s*[:-]\s*([^\n|]{3,100})/i) ?? match(text, /\byour tickets? for\s+([^\n|!.]{3,100})/i), 100);
  const venue = clean(match(text, /\bvenue\s*[:-]\s*([^\n]{3,200})/i), 200);
  if (venue) booking.details.venue = venue;
  const seats = clean(match(text, /\bseats?\s*[:-]\s*([^\n|]{1,40})/i), 40);
  if (seats) booking.details.seats = seats;
  const date = findDates(text, ctx.year)[0];
  const time = date ? findTimes(text.slice(date.index))[0] ?? findTimes(text)[0] : null;
  if (date) booking.startsAt = toInstant(date.value, time?.value ?? '00:00', ctx.timezone);
  return finish(booking);
};

/** Bookings guessed from plain text: none if it doesn't read like a confirmation. */
export const textBookings = (text: string, ctx: ParseContext): Candidate[] => {
  const type = detectType(text);
  switch (type) {
    case 'flight':
      return flights(text, ctx);
    case 'train':
      return [train(text, ctx)].filter((c): c is Candidate => !!c);
    case 'stay':
      return [stay(text, ctx)].filter((c): c is Candidate => !!c);
    case 'restaurant':
      return [restaurant(text, ctx)].filter((c): c is Candidate => !!c);
    case 'car':
      return [car(text, ctx)].filter((c): c is Candidate => !!c);
    case 'ticket':
      return [ticket(text, ctx)].filter((c): c is Candidate => !!c);
    default:
      return [];
  }
};
