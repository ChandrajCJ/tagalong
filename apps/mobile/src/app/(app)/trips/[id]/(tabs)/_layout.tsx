import Feather from '@expo/vector-icons/Feather';
import { TripUnread } from '@tagalong/shared';
import { Tabs } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ColorValue } from 'react-native';
import { request } from '@/lib/api';
import { useTripRealtime } from '@/lib/realtime';
import { useTrip } from '@/lib/trip-context';
import { colors, fonts } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
    <Feather name={icon} color={color as string} size={size - 2} />
  ),
});

/**
 * Bottom tabs: Overview · Plan · Ideas · Chat · Photos · Money. Six is already a
 * lot for a phone, so Docs lives off the Overview instead of in the bar.
 */
export default function TripTabs() {
  const unread = useChatUnread();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11 },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={tab('Overview', 'home')} />
      <Tabs.Screen name="plan" options={tab('Plan', 'calendar')} />
      <Tabs.Screen name="ideas" options={tab('Ideas', 'zap')} />
      <Tabs.Screen
        name="chat"
        options={{
          ...tab('Chat', 'message-square'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.coral, fontFamily: fonts.bold, fontSize: 11 },
        }}
      />
      <Tabs.Screen name="photos" options={tab('Photos', 'image')} />
      <Tabs.Screen name="money" options={tab('Money', 'credit-card')} />
      <Tabs.Screen name="docs" options={{ href: null }} />
    </Tabs>
  );
}

/**
 * How many main-chat messages I haven't read, kept live: a new message,
 * a deleted one or my own reading it refetches the count.
 */
function useChatUnread() {
  const { trip } = useTrip();
  const tripId = trip?.id;
  const me = trip?.myUserId;
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    if (!tripId) return;
    const data = await request(`/trips/${tripId}/unread`, { schema: TripUnread }).catch(() => null);
    if (data) setCount(data.chat);
  }, [tripId]);

  useEffect(() => {
    void load();
    return () => clearTimeout(timer.current);
  }, [load]);

  useTripRealtime(tripId, (m) => {
    const event = m.kind === 'event' ? m.event : null;
    const relevant =
      m.kind === 'reconnected' ||
      (event?.type === 'message.created' && event.actorId !== me) ||
      event?.type === 'message.deleted' ||
      (event?.type === 'read.updated' && event.actorId === me);
    if (!relevant) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(), 300);
  });

  return count;
}
