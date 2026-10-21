import { Stack, useLocalSearchParams } from 'expo-router';
import { LiveLocationBanner } from '@/components/live-location';
import { TripProvider } from '@/lib/trip-context';
import { colors } from '@/theme';

/** The trip hub: tabs, plus Invite, Edit, Members, Get ready, notes and a plan item's detail on top of them. */
export default function TripLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <TripProvider tripId={id}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="invite" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="notifications" options={{ presentation: 'modal' }} />
        <Stack.Screen name="members" />
        <Stack.Screen name="explore" />
        <Stack.Screen name="items/[itemId]" />
        <Stack.Screen name="lists" />
        <Stack.Screen name="notes/[noteId]" />
        <Stack.Screen name="imports" />
      </Stack>
      {/* On every screen of the trip while I'm sharing my location with it. */}
      <LiveLocationBanner tripId={id} />
    </TripProvider>
  );
}
