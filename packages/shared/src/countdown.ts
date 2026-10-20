/**
 * The countdown pushes before a trip: a week out, three days out, the
 * evening before and the morning of. Pure, so the worker job stays thin and
 * the wording is tested here.
 */

export const COUNTDOWN_STAGES = ['week', 'three', 'eve', 'day'] as const;
export type CountdownStage = (typeof COUNTDOWN_STAGES)[number];

/** Days before the trip's first day, and the hour on the person's own clock from which it goes. */
const SCHEDULE: { stage: CountdownStage; daysLeft: number; hour: number }[] = [
  { stage: 'week', daysLeft: 7, hour: 9 },
  { stage: 'three', daysLeft: 3, hour: 9 },
  { stage: 'eve', daysLeft: 1, hour: 19 },
  { stage: 'day', daysLeft: 0, hour: 8 },
];

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/**
 * Which countdown is due now, if any: the person's own date and time decide,
 * from the stage's hour until the end of that day.
 */
export const countdownStage = (startDate: string, local: { date: string; time: string }): CountdownStage | null => {
  const daysLeft = Math.round(dayNumber(startDate) - dayNumber(local.date));
  const hour = Number(local.time.slice(0, 2));
  return SCHEDULE.find((s) => s.daysLeft === daysLeft && hour >= s.hour)?.stage ?? null;
};

/** Where someone stands on getting ready: their own ticks on "everyone" lines, and shared lines still open. */
export interface Readiness {
  packed: number;
  packingTotal: number;
  todosOpen: number;
}

export interface CountdownFacts {
  tripName: string;
  readiness: Readiness;
  /** The first day's forecast, for the evening before. */
  weather?: { maxC: number; minC: number; rainChance: number | null } | null;
  /** The first booking or timed stop on the first day, for the morning of. */
  firstUp?: { title: string; time: string } | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The push for a stage, and what a tap opens: the lists while there's packing
 * to do, the trip on the day. Null when there's nothing worth saying (a week
 * out with nothing left to do).
 */
export const countdownMessage = (stage: CountdownStage, facts: CountdownFacts): { body: string; opens: 'lists' | 'trip' } | null => {
  const toPack = facts.readiness.packingTotal - facts.readiness.packed;
  const todos = facts.readiness.todosOpen;
  const packLine = toPack > 0 ? plural(toPack, 'item to pack', 'items to pack') : null;
  const todoLine = todos > 0 ? `${plural(todos, 'to-do', 'to-dos')} still open` : null;
  switch (stage) {
    case 'week': {
      if (!packLine && !todoLine) return null;
      return { body: `A week to ${facts.tripName}! ${[todoLine, packLine].filter(Boolean).join(' · ')}.`, opens: 'lists' };
    }
    case 'three':
      return { body: `3 days to go · ${packLine ?? (todos > 0 ? `${plural(todos, 'to-do', 'to-dos')} open` : 'all packed')}.`, opens: 'lists' };
    case 'eve': {
      const w = facts.weather;
      const weather = w ? `weather ${w.maxC}°/${w.minC}°${(w.rainChance ?? 0) >= 50 ? ', rain likely' : ''}` : null;
      return { body: [`Tomorrow: ${facts.tripName}`, weather, packLine].filter(Boolean).join(' · '), opens: packLine ? 'lists' : 'trip' };
    }
    case 'day':
      return {
        body: facts.firstUp ? `Today’s the day! First up: ${facts.firstUp.title} at ${facts.firstUp.time}.` : 'Today’s the day! Have a great trip.',
        opens: 'trip',
      };
  }
};
