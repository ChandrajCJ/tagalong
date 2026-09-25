import { uuidv7 } from 'uuidv7';

/**
 * Time-ordered UUIDs. Clients generate ids for new rows so they can create
 * data offline and retry requests without creating duplicates.
 */
export const newId = (): string => uuidv7();
