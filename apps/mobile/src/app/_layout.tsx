import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { Fraunces_600SemiBold, useFonts } from '@expo-google-fonts/fraunces';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ServerWakingBanner } from '@/components/server-waking-banner';
import { UpdateBanner } from '@/components/update-banner';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, scheme } from '@/theme';

SplashScreen.preventAutoHideAsync();
// What shows behind screens while they open, so dark mode never flashes white.
void SystemUI.setBackgroundColorAsync(colors.bg).catch(() => undefined);

function Navigator() {
  const { status } = useSession();
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });
  const ready = fontsLoaded && status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        {/* Signed-out screens and signed-in screens can't be reached from each other. */}
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        {/* Invite links work whether or not you're signed in. */}
        <Stack.Screen name="invite/[token]" />
      </Stack>
      <ServerWakingBanner />
      <UpdateBanner />
    </>
  );
}

export default function RootLayout() {
  return (
    // Needed for drag and drop (and any other gestures) anywhere in the app.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <Navigator />
      </SessionProvider>
    </GestureHandlerRootView>
  );
}
