export const TRIP_ROLES = ['viewer', 'editor', 'owner'] as const;
export type TripRole = (typeof TRIP_ROLES)[number];

/** True when `role` grants at least the access of `required`. */
export const hasRole = (role: TripRole, required: TripRole): boolean =>
  TRIP_ROLES.indexOf(role) >= TRIP_ROLES.indexOf(required);
