import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { Fraunces_600SemiBold, useFonts } from '@expo-google-fonts/fraunces';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '@/lib/session';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

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
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        {/* Signed-out screens and signed-in screens can't be reached from each other. */}
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Navigator />
    </SessionProvider>
  );
}
