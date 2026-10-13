import { toInstant, type BookingType } from '@tagalong/shared';
import { AIRPORTS } from './airports';
import { decodeEntities, toMinor } from './text-utils';
import type { Candidate, ParseContext } from './types';

/**
 * schema.org reservations that airlines, hotels and booking sites embed in
 * their emails (the same markup Gmail reads for its cards), as JSON-LD or
 * microdata. When they're there, they're right, so they win over text guesses.
 */

type Thing = Record<string, unknown>;

const typeOf = (t: Thing) => {
  const raw = t['@type'] ?? t.type;
  const name = Array.isArray(raw) ? raw[0] : raw;
  return typeof name === 'string' ? name.replace(/^https?:\/\/schema\.org\//, '') : '';
};

/** Every object in a JSON-LD value, walking @graph and arrays. */
const flatten = (value: unknown): Thing[] => {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (!value || typeof value !== 'object') return [];
  const t = value as Thing;
  return Array.isArray(t['@graph']) ? flatten(t['@graph']) : [t];
};

export const readJsonLd = (html: string): Thing[] => {
  const out: Thing[] = [];
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    try {
      out.push(...flatten(JSON.parse(decodeEntities(m[1]!.trim()))));
    } catch {
      // A broken block shouldn't hide the others.
    }
  }
  return out;
};

/**
 * Microdata (itemscope/itemprop) as plain objects. A small tag walker rather
 * than a full HTML parser: values come from content/datetime/href attributes,
 * or the element's text.
 */
export const readMicrodata = (html: string): Thing[] => {
  const roots: Thing[] = [];
  type Open = { tag: string; scope?: Thing; prop?: string; text: string; parentScope: Thing | null };
  const stack: Open[] = [];
  const currentScope = () => [...stack].reverse().find((o) => o.scope)?.scope ?? null;
  const set = (scope: Thing | null, prop: string, value: unknown) => {
    if (!scope) return;
    for (const p of prop.split(/\s+/)) scope[p] = scope[p] === undefined ? value : scope[p];
  };
  const attr = (attrs: string, name: string) => {
    const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
    return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
  };
  const VOID = new Set(['meta', 'link', 'img', 'br', 'hr', 'input', 'source']);
  const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[5] !== undefined) {
      for (const o of stack) if (o.prop && !o.scope) o.text += m[5];
      continue;
    }
    const [, closing, rawTag, attrs = ''] = m;
    const tag = rawTag!.toLowerCase();
    if (closing) {
      const at = stack.map((o) => o.tag).lastIndexOf(tag);
      if (at === -1) continue;
      for (const o of stack.splice(at).reverse()) {
        if (o.scope && o.prop) set(o.parentScope, o.prop, o.scope);
        else if (o.prop) set(o.parentScope, o.prop, decodeEntities(o.text).replace(/\s+/g, ' ').trim());
      }
      continue;
    }
    const prop = attr(attrs, 'itemprop') ?? undefined;
    const hasScope = /\bitemscope\b/i.test(attrs);
    const parentScope = currentScope();
    if (hasScope) {
      const scope: Thing = { '@type': attr(attrs, 'itemtype') ?? '' };
      if (!prop) roots.push(scope);
      if (VOID.has(tag) || m[4]) {
        if (prop) set(parentScope, prop, scope);
      } else stack.push({ tag, scope, prop, text: '', parentScope });
      continue;
    }
    if (prop) {
      const value = attr(attrs, 'content') ?? attr(attrs, 'datetime') ?? attr(attrs, 'href') ?? attr(attrs, 'src');
      if (value !== null || VOID.has(tag) || m[4]) set(parentScope, prop, value ?? '');
      else stack.push({ tag, prop, text: '', parentScope });
      continue;
    }
    if (!VOID.has(tag) && !m[4]) stack.push({ tag, text: '', parentScope });
  }
  return roots;
};

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') return str((v as Thing).name);
  return null;
};
const obj = (v: unknown): Thing => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Thing) : Array.isArray(v) ? obj(v[0]) : {});

/** A postal address as one line, or a plain string as it is. */
const address = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  const a = obj(v);
  const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].map(str).filter(Boolean);
  return parts.length ? parts.join(', ') : null;
};

/**
 * An ISO date-time from the markup as a real instant. With an offset it's
 * exact; without one it's a wall-clock time in `tz`.
 */
const instant = (v: unknown, tz: string): string | null => {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) {
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const [, date, time, offset] = m;
  if (offset) return new Date(`${date}T${time ?? '00:00'}:00${offset.length === 5 ? `${offset.slice(0, 3)}:${offset.slice(3)}` : offset}`).toISOString();
  return toInstant(date!, time ?? '00:00', tz);
};

const RESERVATION_TYPES: Record<string, BookingType> = {
  FlightReservation: 'flight',
  LodgingReservation: 'stay',
  TrainReservation: 'train',
  BusReservation: 'train',
  EventReservation: 'ticket',
  RentalCarReservation: 'car',
  FoodEstablishmentReservation: 'restaurant',
};

const seatsOf = (r: Thing) => {
  const seat = obj(obj(r.reservedTicket).ticketedSeat);
  return str(seat.seatNumber) ?? str(r.airplaneSeat) ?? null;
};

/** One schema.org reservation as a booking candidate, or null for anything else. */
const fromReservation = (r: Thing, ctx: ParseContext): Candidate | null => {
  const type = RESERVATION_TYPES[typeOf(r)];
  if (!type) return null;
  const what = obj(r.reservationFor);
  const details: Record<string, string | number> = {};
  const put = (key: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && value !== '') details[key] = value;
  };
  let provider: string | null = null;
  let timezone = ctx.timezone;
  let startsAt: string | null = null;
  let endsAt: string | null = null;

  switch (type) {
    case 'flight': {
      const airline = obj(what.airline ?? what.provider);
      const from = obj(what.departureAirport);
      const to = obj(what.arrivalAirport);
      const fromCode = str(from.iataCode);
      const toCode = str(to.iataCode);
      const zone = (code: string | null) => (code ? AIRPORTS.get(code.toUpperCase())?.timezone : undefined);
      timezone = zone(fromCode) ?? timezone;
      provider = str(airline.name) ?? null;
      const number = str(what.flightNumber);
      const code = str(airline.iataCode);
      put('flightNumber', number && code && !number.startsWith(code) ? `${code} ${number}` : number);
      put('from', fromCode ?? str(from.name));
      put('to', toCode ?? str(to.name));
      put('terminal', str(what.departureTerminal));
      put('gate', str(what.departureGate));
      put('seats', seatsOf(r));
      startsAt = instant(what.departureTime, timezone);
      endsAt = instant(what.arrivalTime, zone(toCode) ?? timezone);
      break;
    }
    case 'stay':
      provider = str(what.name);
      put('address', address(what.address));
      put('phone', str(what.telephone));
      put('room', str(r.lodgingUnitDescription) ?? str(r.lodgingUnitType));
      startsAt = instant(r.checkinTime ?? r.checkinDate, timezone);
      endsAt = instant(r.checkoutTime ?? r.checkoutDate, timezone);
      break;
    case 'train': {
      provider = str(what.provider) ?? str(r.provider);
      const seat = obj(obj(r.reservedTicket).ticketedSeat);
      put('trainNumber', str(what.trainNumber) ?? str(what.busNumber));
      put('from', str(what.departureStation) ?? str(what.departureBusStop));
      put('to', str(what.arrivalStation) ?? str(what.arrivalBusStop));
      put('coach', str(seat.seatSection));
      put('seats', str(seat.seatNumber));
      startsAt = instant(what.departureTime, timezone);
      endsAt = instant(what.arrivalTime, timezone);
      break;
    }
    case 'ticket': {
      provider = str(what.name);
      const place = obj(what.location);
      put('venue', [str(place.name), address(place.address)].filter(Boolean).join(', ') || null);
      put('seats', seatsOf(r));
      startsAt = instant(what.startDate, timezone);
      endsAt = instant(what.endDate, timezone);
      break;
    }
    case 'car':
      provider = str(r.provider) ?? str(obj(what).rentalCompany);
      put('pickup', [str(obj(r.pickupLocation).name), address(obj(r.pickupLocation).address)].filter(Boolean).join(', ') || null);
      put('dropoff', [str(obj(r.dropoffLocation).name), address(obj(r.dropoffLocation).address)].filter(Boolean).join(', ') || null);
      startsAt = instant(r.pickupTime, timezone);
      endsAt = instant(r.dropoffTime, timezone);
      break;
    case 'restaurant': {
      provider = str(what.name);
      put('address', address(what.address));
      put('phone', str(what.telephone));
      const party = Number(str(r.partySize));
      if (Number.isInteger(party) && party > 0) details.partySize = party;
      startsAt = instant(r.startTime, timezone);
      break;
    }
  }

  const price = toMinor(r.totalPrice ?? r.price);
  const currency = str(r.priceCurrency)?.toUpperCase() ?? null;
  const booking = {
    type,
    provider,
    reference: str(r.reservationNumber) ?? str(r.confirmationNumber),
    startsAt,
    endsAt: endsAt && startsAt && endsAt < startsAt ? null : endsAt,
    timezone,
    details,
    costMinor: price !== null && currency?.length === 3 ? price : null,
    costCurrency: price !== null && currency?.length === 3 ? currency : null,
  };
  const found = [
    ...Object.keys(details),
    ...(['provider', 'reference', 'startsAt', 'endsAt', 'costMinor'] as const).filter((k) => booking[k] !== null),
  ];
  return { booking, confidence: 'high', found };
};

/** Reservations in an email's HTML, from JSON-LD first, then microdata. */
export const structuredBookings = (html: string, ctx: ParseContext): Candidate[] => {
  const things = readJsonLd(html);
  const source = things.some((t) => RESERVATION_TYPES[typeOf(t)]) ? things : readMicrodata(html);
  // Some senders nest reservations inside an order or a list.
  const all = source.flatMap(function walk(t): Thing[] {
    const nested = [t.reservation, t.subReservation, t.itemListElement, t.item].flatMap((v) => (v ? flatten(v) : []));
    return [t, ...nested.flatMap(walk)];
  });
  const seen = new Set<string>();
  return all.flatMap((t) => {
    const candidate = fromReservation(t, ctx);
    if (!candidate) return [];
    const key = JSON.stringify([candidate.booking.reference, candidate.booking.startsAt, candidate.booking.details]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [candidate];
  });
};
