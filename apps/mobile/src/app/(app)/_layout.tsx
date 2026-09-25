import { Stack } from 'expo-router';
import { colors } from '@/theme';

export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="trips/index" />
      <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trips/[id]" />
    </Stack>
  );
}
