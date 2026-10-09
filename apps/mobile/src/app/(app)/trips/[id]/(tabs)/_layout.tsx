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
 * Bottom tabs: Overview · Plan · Ideas · Chat · Photos · Docs. Six is already a
 * lot for a phone, so Money stays hidden until it's built for real.
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
      <Tabs.Screen name="photos" options={tab('Photos', 'image')} />
      <Tabs.Screen name="docs" options={tab('Docs', 'folder')} />
      <Tabs.Screen name="money" options={{ href: null }} />
    </Tabs>
  );
}
