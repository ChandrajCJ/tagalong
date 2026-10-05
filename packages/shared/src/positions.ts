import { generateKeyBetween } from 'fractional-indexing';

/**
 * A sort key that falls between `before` and `after` (null = the start or the
 * end). Moving an item changes only its own key, so nothing gets renumbered.
 */
export const positionBetween = (before: string | null, after: string | null): string =>
  generateKeyBetween(before, after);
