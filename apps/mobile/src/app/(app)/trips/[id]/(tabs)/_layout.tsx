import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { colors, fonts } from '@/theme';

type IconName = React.ComponentProps<typeof Feather>['name'];

const tab = (title: string, icon: IconName) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
    <Feather name={icon} color={color as string} size={size - 2} />
  ),
});

/**
 * Bottom tabs: Overview · Plan · Ideas · Chat · Docs · Money. Six is already a
 * lot for a phone, so Photos stays hidden until Phase 3 builds it for real.
 */
export default function TripTabs() {
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
      <Tabs.Screen name="chat" options={tab('Chat', 'message-square')} />
      <Tabs.Screen name="docs" options={tab('Docs', 'folder')} />
      <Tabs.Screen name="photos" options={{ href: null }} />
      <Tabs.Screen name="money" options={tab('Money', 'credit-card')} />
    </Tabs>
  );
}
