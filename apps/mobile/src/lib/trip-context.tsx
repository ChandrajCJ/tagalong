import { Trip } from '@tagalong/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, request } from './api';

interface TripValue {
  trip: Trip | undefined;
  error: string | undefined;
  reload: () => Promise<void>;
}

const TripContext = createContext<TripValue | null>(null);

/** Loads one trip and shares it with every screen in the trip hub. */
export function TripProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [trip, setTrip] = useState<Trip>();
  const [error, setError] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setTrip(await request(`/trips/${tripId}`, { schema: Trip }));
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this trip');
    }
  }, [tripId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return <TripContext.Provider value={{ trip, error, reload }}>{children}</TripContext.Provider>;
}

export const useTrip = () => {
  const value = useContext(TripContext);
  if (!value) throw new Error('useTrip must be used inside TripProvider');
  return value;
};
