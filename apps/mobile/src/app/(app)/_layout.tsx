import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '@/lib/session';
import { colors } from '@/theme';

export default function AppLayout() {
  const { pendingInvite } = useSession();

  // Someone opened an invite link, then signed in: take them back to it.
  useEffect(() => {
    if (pendingInvite) router.push(`/invite/${pendingInvite}`);
  }, [pendingInvite]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="trips/index" />
      <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trips/[id]" />
    </Stack>
  );
}
