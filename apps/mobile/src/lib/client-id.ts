import { newId } from '@tagalong/shared';

/**
 * Identifies this app session to the server. The API tags each change with it,
 * so the realtime gateway doesn't echo our own changes back to us.
 */
export const CLIENT_ID = newId();
