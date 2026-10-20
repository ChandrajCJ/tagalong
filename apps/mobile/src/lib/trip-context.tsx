import { Trip } from '@tagalong/shared';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Title } from '@/components/ui';
import { colors, space } from '@/theme';
import { ApiError, request } from './api';
import { AvatarPhotos, photosOf } from './avatars';
import { CLIENT_ID } from './client-id';
import { useTripRealtime } from './realtime';
import { requestReminderSync } from './reminders';

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
  // The owner deleted the trip while we had it open.
  const [deleted, setDeleted] = useState(false);

  const reload = useCallback(async () => {
    try {
      setTrip(await request(`/trips/${tripId}`, { schema: Trip }));
      setError(undefined);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this trip');
    }
  }, [tripId]);

  useEffect(() => {
    setDeleted(false);
    void reload();
  }, [reload]);

  // Someone renamed the trip or changed its dates: every screen follows.
  useTripRealtime(tripId, (message) => {
    if (message.kind !== 'event') return;
    if (message.event.type === 'trip.updated' || message.event.type.startsWith('place.')) void reload();
    // A stop or booking was added, moved or removed: reminders follow.
    if (/^(item|booking|day|place)\.|^trip\.updated$/.test(message.event.type)) requestReminderSync();
    // Whoever deleted it already left; everyone else is told why it's gone.
    if (message.event.type === 'trip.deleted' && message.event.originClientId !== CLIENT_ID) setDeleted(true);
  });

  // Everyone's profile photos, for any avatar on the trip's screens.
  const photos = useMemo(() => photosOf(trip?.members ?? []), [trip?.members]);

  if (deleted) {
    return (
      <SafeAreaView style={styles.gone}>
        <Title style={{ fontSize: 24, textAlign: 'center' }}>This trip was deleted</Title>
        <Body style={{ textAlign: 'center' }}>
          {trip ? `An owner deleted ${trip.name}, so it’s gone for everyone.` : 'An owner deleted it, so it’s gone for everyone.'}
        </Body>
        <Button label="Back to your trips" onPress={() => router.replace('/trips')} />
      </SafeAreaView>
    );
  }

  return (
    <TripContext.Provider value={{ trip, error, reload }}>
      <AvatarPhotos.Provider value={photos}>{children}</AvatarPhotos.Provider>
    </TripContext.Provider>
  );
}

export const useTrip = () => {
  const value = useContext(TripContext);
  if (!value) throw new Error('useTrip must be used inside TripProvider');
  return value;
};

const styles = StyleSheet.create({
  gone: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl, backgroundColor: colors.bg },
});
