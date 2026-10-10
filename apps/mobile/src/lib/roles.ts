import type { TripRole } from '@tagalong/shared';

/** What each role can do, in one place so every screen says the same thing. */
export const ROLE_HELP: Record<TripRole, string> = {
  owner: 'Can do everything editors can, and manage who’s on the trip.',
  editor: 'Can plan, chat, add expenses, photos and files, and invite people.',
  viewer: 'Can see everything, vote on ideas and polls, and heart photos, but can’t add or change anything.',
};

export const ROLE_NAME: Record<TripRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

/** "you're the owner", "you're an editor", "you're a viewer". */
export const youAre = (role: TripRole) =>
  role === 'owner' ? 'you’re the owner' : role === 'editor' ? 'you’re an editor' : 'you’re a viewer';

/** Shown where a viewer would otherwise wonder why there's no Add button. */
export const VIEWER_NOTE = 'You’re a viewer, so only editors can add things here. The trip owner can make you an editor.';
