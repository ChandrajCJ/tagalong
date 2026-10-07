import { Stack, useLocalSearchParams } from 'expo-router';
import { TripProvider } from '@/lib/trip-context';
import { colors } from '@/theme';

/** The trip hub: tabs, plus Invite, Members and a plan item's detail on top of them. */
export default function TripLayout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <TripProvider tripId={id}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="invite" options={{ presentation: 'modal' }} />
        <Stack.Screen name="members" />
        <Stack.Screen name="items/[itemId]" />
      </Stack>
    </TripProvider>
  );
}
