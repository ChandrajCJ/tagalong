import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useSharingLifecycle } from '@/lib/live-location';
import { resetPushRegistration, usePushNavigation } from '@/lib/push';
import { realtime } from '@/lib/realtime';
import { useReminderSync } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { clearWidget, useWidgetSync } from '@/lib/widget';
import { colors } from '@/theme';

export default function AppLayout() {
  const { pendingInvite } = useSession();

  // Someone opened an invite link, then signed in: take them back to it.
  useEffect(() => {
    if (pendingInvite) router.push(`/invite/${pendingInvite}`);
  }, [pendingInvite]);

  // Live updates run while signed in, and stop on sign-out.
  useEffect(() => {
    realtime.start();
    return () => {
      realtime.stop();
      resetPushRegistration();
      void clearWidget();
    };
  }, []);

  // Tapping a notification opens the screen it's about.
  usePushNavigation();
  // Reminders before timed stops, scheduled on the phone.
  useReminderSync();
  // Live location carries on across restarts until its time runs out.
  useSharingLifecycle();
  // The Android home-screen widget's countdown and today's next stop.
  useWidgetSync();

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="trips/index" />
      <Stack.Screen name="trips/new" options={{ presentation: 'modal' }} />
      <Stack.Screen name="trips/[id]" />
      <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
