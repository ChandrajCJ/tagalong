/**
 * Trip journal logic shared by the API, the worker jobs and the phone: the
 * auto-filled day header, the end-of-trip recap, and when to nudge people.
 */
import { metresBetween } from './places';
import type { DayStop, RecapData } from './schemas/journal';
import { dayPlaceLabel, placeForDate, type DatedPlace } from './trip-places';

const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};

const addDays = (iso: string, n: number) => new Date((dayNumber(iso) + n) * 86_400_000).toISOString().slice(0, 10);

/** Every date from `from` to `to`, both included. */
export const datesBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

/** 1 for the trip's first day; null outside its dates, or without dates. */
export const dayNumberOf = (startDate: string | null, endDate: string | null, date: string) => {
  if (!startDate || date < startDate || date > (endDate ?? startDate)) return null;
  return dayNumber(date) - dayNumber(startDate) + 1;
};

/** The YYYY-MM-DD part of a photo's local taken-at time. */
export const takenOn = (takenAt: string | null) => (takenAt ? takenAt.slice(0, 10) : null);

/**
 * The 10 minutes of the day with the most chat messages, when at least three
 * fell in them: `from` is the first message's time and `messageId` links to it.
 */
export const busiestMoment = (messages: { id: string; createdAt: string }[], windowMin = 10, atLeast = 3) => {
  const sorted = [...messages].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const times = sorted.map((m) => Date.parse(m.createdAt));
  let best: { start: number; count: number } | null = null;
  for (let i = 0, j = 0; i < sorted.length; i++) {
    while (j < sorted.length && times[j]! - times[i]! < windowMin * 60_000) j++;
    const count = j - i;
    if (count >= atLeast && (!best || count > best.count)) best = { start: i, count };
  }
  return best ? { from: sorted[best.start]!.createdAt, count: best.count, messageId: sorted[best.start]!.id } : null;
};

/** The most favourited first, then the first ones taken, to fill up to `n`. */
export const topPhotos = <P extends { id: string; favourites: number; takenAt: string | null }>(photos: P[], n: number) => {
  const byTime = (a: P, b: P) => ((a.takenAt ?? '') < (b.takenAt ?? '') ? -1 : (a.takenAt ?? '') > (b.takenAt ?? '') ? 1 : a.id < b.id ? -1 : 1);
  const loved = photos.filter((p) => p.favourites > 0).sort((a, b) => b.favourites - a.favourites || byTime(a, b));
  const rest = photos.filter((p) => p.favourites === 0).sort(byTime);
  return [...loved, ...rest].slice(0, n);
};

/** Straight lines between consecutive located points: a floor for the distance really travelled. */
export const straightDistance = (points: { latitude: number | null; longitude: number | null }[]) => {
  const located = points.filter((p): p is { latitude: number; longitude: number } => p.latitude !== null && p.longitude !== null);
  let total = 0;
  for (let i = 1; i < located.length; i++) total += metresBetween(located[i - 1]!, located[i]!);
  return Math.round(total);
};

export interface DayHeaderInput {
  date: string;
  trip: { startDate: string | null; endDate: string | null; currency: string; headcount: number };
  city: string | null;
  centre: { latitude: number; longitude: number } | null;
  /** The day's plan stops, in plan order. */
  stops: DayStop[];
  /** Photos and videos taken that day that the viewer can see. */
  photos: { id: string; kind: 'photo' | 'video'; favourites: number; takenAt: string | null }[];
  /** Main-chat messages sent that day (on the trip's clock). */
  messages: { id: string; createdAt: string }[];
  expenses: { baseAmountMinor: number }[];
  /** Promoted ideas with the date of the plan item each became, and their up votes. */
  ideas: { id: string; title: string; votes: number; itemDate: string | null }[];
}

/** The day header, with its top photos as ids for the server to sign. */
export const dayHeader = (input: DayHeaderInput) => {
  const spent = input.expenses.reduce((sum, e) => sum + e.baseAmountMinor, 0);
  const idea = input.ideas
    .filter((i) => i.itemDate === input.date && i.votes > 0)
    .sort((a, b) => b.votes - a.votes || (a.title < b.title ? -1 : 1))[0];
  const located = input.stops.filter((s) => s.latitude !== null && s.longitude !== null);
  return {
    date: input.date,
    dayNumber: dayNumberOf(input.trip.startDate, input.trip.endDate, input.date),
    city: input.city,
    centre: input.centre,
    stops: input.stops,
    distanceM: located.length >= 2 ? straightDistance(located) : null,
    photoCount: input.photos.filter((p) => p.kind === 'photo').length,
    videoCount: input.photos.filter((p) => p.kind === 'video').length,
    messageCount: input.messages.length,
    spentMinor: spent,
    spentPerPersonMinor: Math.round(spent / Math.max(1, input.trip.headcount)),
    currency: input.trip.currency,
    topPhotoIds: topPhotos(input.photos, 4).map((p) => p.id),
    topIdea: idea ? { id: idea.id, title: idea.title, votes: idea.votes } : null,
    busiest: busiestMoment(input.messages),
  };
};

/** The evening questions, one a day in turn. */
export const JOURNAL_QUESTIONS = [
  'what was the best moment?',
  'Best thing you ate today?',
  'Something that surprised you?',
  'Quote of the day?',
] as const;

/** "Day 2 in Goa: what was the best moment?", then a different question each day. */
export const journalPrompt = (dayNo: number, city: string | null) => {
  const question = JOURNAL_QUESTIONS[(dayNo - 1) % JOURNAL_QUESTIONS.length]!;
  if (question !== JOURNAL_QUESTIONS[0]) return question;
  return `Day ${dayNo}${city ? ` in ${city}` : ''}: ${question}`;
};

/**
 * Whether the evening prompt is due: during the trip, from `at` until the
 * day ends on the trip's clock. Returns that trip day, or null.
 */
export const promptDay = (
  local: { date: string; time: string },
  trip: { startDate: string | null; endDate: string | null },
  at: string,
) => {
  if (dayNumberOf(trip.startDate, trip.endDate, local.date) === null) return null;
  return local.time >= at ? local.date : null;
};

/** One-tap starters on an empty day page; each prefills an entry. */
export const JOURNAL_STARTERS = [
  { key: 'best', label: 'Best part of today', text: 'Best part of today: ' },
  { key: 'meal', label: 'Best meal', text: 'Best meal: ' },
  { key: 'funny', label: 'Funniest moment', text: 'Funniest moment: ' },
  { key: 'quote', label: 'Quote of the day', text: 'Quote of the day: “' },
] as const;

/** The same calendar day `years` earlier; 29 February becomes the 28th. */
const yearsBefore = (iso: string, years: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const day = m === 2 && d === 29 ? 28 : d!;
  return `${y! - years}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * "On this day": the day of a past trip that falls on today's date in an
 * earlier year, the most recent first. Null for this year's trips.
 */
export const memoryFor = (trip: { startDate: string | null; endDate: string | null }, today: string) => {
  if (!trip.startDate) return null;
  const end = trip.endDate ?? trip.startDate;
  const span = Number(today.slice(0, 4)) - Number(trip.startDate.slice(0, 4));
  for (let years = 1; years <= span; years++) {
    const date = yearsBefore(today, years);
    if (date >= trip.startDate && date <= end) return { date, yearsAgo: years };
  }
  return null;
};

/** "A year ago today you were at Dudhsagar Falls", or "…in Goa" without a stop. */
export const memoryLine = (yearsAgo: number, where: { stop: string | null; city: string | null }) => {
  const when = yearsAgo === 1 ? 'A year ago today' : `${yearsAgo} years ago today`;
  if (where.stop) return `${when} you were at ${where.stop}`;
  return where.city ? `${when} you were in ${where.city}` : `${when} you were on this trip`;
};

/**
 * The recap push goes the morning after the trip's last day (from 9:00 on
 * the trip's clock), and only that first week, so an old trip stays quiet.
 */
export const recapDue = (endDate: string | null, local: { date: string; time: string }) =>
  !!endDate && local.date > endDate && local.date <= addDays(endDate, 7) && local.time >= '09:00';

/** Whether the trip is over on this date: its recap is final. */
export const tripOver = (trip: { startDate: string | null; endDate: string | null }, today: string) => {
  const last = trip.endDate ?? trip.startDate;
  return !!last && last < today;
};

const EMOJI = /\p{Extended_Pictographic}️?/gu;

export interface RecapInput {
  trip: { startDate: string | null; endDate: string | null };
  /** The trip's places in trip order. */
  places: (DatedPlace & { destination: string; latitude: number | null; longitude: number | null })[];
  /** Plan items with a day, in plan order within each day. */
  items: { date: string | null; title: string; latitude: number | null; longitude: number | null }[];
  photos: { id: string; kind: 'photo' | 'video'; favourites: number; takenAt: string | null }[];
  messages: { body: string }[];
  /** Every reaction on chat messages and journal entries. */
  reactions: { emoji: string }[];
  expenses: { description: string; baseAmountMinor: number; splits: { userId: string; shareMinor: number }[] }[];
  /** Journal entries; private ones are dropped here whoever passes them. */
  entries: { authorId: string; date: string; body: string; mood: string | null; visibility: string }[];
}

const SNIPPET = 200;

/** Everything the recap shows, from a trip's rows. Photos are ids. */
export const tripRecap = (input: RecapInput): RecapData => {
  const { startDate } = input.trip;
  const endDate = input.trip.endDate ?? startDate;
  const dates = startDate && endDate ? datesBetween(startDate, endDate) : [];

  const days = dates.map((date, i) => {
    const day = placeForDate(input.places, date);
    const route = input.items
      .filter((it) => it.date === date && it.latitude !== null && it.longitude !== null)
      .map((it) => ({ latitude: it.latitude!, longitude: it.longitude!, title: it.title }));
    const photos = input.photos.filter((p) => takenOn(p.takenAt) === date);
    const snippets = input.entries
      .filter((e) => e.visibility === 'group' && e.date === date)
      .slice(0, 3)
      .map((e) => ({
        authorId: e.authorId,
        body: e.body.length > SNIPPET ? `${e.body.slice(0, SNIPPET - 1)}…` : e.body,
        mood: (e.mood ?? null) as RecapData['days'][number]['snippets'][number]['mood'],
      }));
    return {
      date,
      dayNumber: i + 1,
      city: day ? dayPlaceLabel(day) : null,
      route,
      topPhotoIds: topPhotos(photos, 3).map((p) => p.id),
      snippets,
    };
  });

  // Around each day's stops, plus the journeys between the trip's places.
  const distanceM =
    days.reduce((sum, d) => sum + straightDistance(d.route), 0) + straightDistance(input.places);

  const emoji = new Map<string, { shown: string; count: number }>();
  const count = (e: string) => {
    const key = e.replace(/️/g, '');
    const seen = emoji.get(key);
    emoji.set(key, { shown: seen?.shown ?? e, count: (seen?.count ?? 0) + 1 });
  };
  for (const r of input.reactions) count(r.emoji);
  for (const m of input.messages) for (const e of m.body.match(EMOJI) ?? []) count(e);
  const topEmoji = [...emoji.values()].sort((a, b) => b.count - a.count)[0]?.shown ?? null;

  const shares = new Map<string, number>();
  for (const e of input.expenses) for (const s of e.splits) shares.set(s.userId, (shares.get(s.userId) ?? 0) + s.shareMinor);
  const biggest = [...input.expenses].sort((a, b) => b.baseAmountMinor - a.baseAmountMinor)[0];

  return {
    stats: {
      days: dates.length,
      places: new Set(input.places.map((p) => p.destination.split(',')[0]!.trim())).size,
      distanceM,
      photos: input.photos.filter((p) => p.kind === 'photo').length,
      videos: input.photos.filter((p) => p.kind === 'video').length,
      messages: input.messages.length,
      topEmoji,
      topPhotoIds: topPhotos(input.photos, 3).map((p) => p.id),
      spend: [...shares]
        .map(([userId, shareMinor]) => ({ userId, shareMinor }))
        .sort((a, b) => b.shareMinor - a.shareMinor || (a.userId < b.userId ? -1 : 1)),
      biggestExpense: biggest ? { description: biggest.description, amountMinor: biggest.baseAmountMinor } : null,
    },
    days,
    groupPhotoIds: topPhotos(input.photos.filter((p) => p.kind === 'photo'), 12).map((p) => p.id),
  };
};
