import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { request } from './api';

export type PushStatus = 'registered' | 'denied' | 'unavailable';

/**
 * Push needs a real phone and an Expo project id (run `npx eas-cli init` once
 * with a free Expo account). Expo Go on Android can't receive pushes at all
 * since SDK 53; there it needs a development build.
 */
const projectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

const pushSupported = () =>
  Platform.OS !== 'web' &&
  Device.isDevice &&
  !(Platform.OS === 'android' && Constants.executionEnvironment === 'storeClient') &&
  !!projectId();

// Loaded lazily so the app never touches the module where push can't work.
const notifications = () => import('expo-notifications');

let registered: Promise<PushStatus> | null = null;

/**
 * Asks for permission (once) and tells the server where to send pushes.
 * Call it at a moment the request makes sense, e.g. after joining a trip.
 */
export const registerForPush = (): Promise<PushStatus> => {
  registered ??= (async (): Promise<PushStatus> => {
    if (!pushSupported()) return 'unavailable';
    try {
      const N = await notifications();
      N.setNotificationHandler({
        handleNotification: async () => ({
          shouldPlaySound: false,
          shouldSetBadge: false,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      let { status } = await N.getPermissionsAsync();
      if (status !== 'granted') ({ status } = await N.requestPermissionsAsync());
      if (status !== 'granted') return 'denied';
      if (Platform.OS === 'android') {
        await N.setNotificationChannelAsync('default', {
          name: 'Messages',
          importance: N.AndroidImportance.HIGH,
        });
      }
      const { data: token } = await N.getExpoPushTokenAsync({ projectId: projectId() });
      await request('/me/devices/push-token', {
        method: 'POST',
        body: { token, platform: Platform.OS },
      });
      return 'registered';
    } catch {
      return 'unavailable';
    }
  })();
  return registered;
};

/** Forget registration on sign-out, so the next account registers its own. */
export const resetPushRegistration = () => {
  registered = null;
};

/** Opens the right screen when someone taps a notification (including from a cold start). */
export function usePushNavigation() {
  useEffect(() => {
    if (!pushSupported()) return;
    let subscription: { remove: () => void } | undefined;
    const open = (data: unknown) => {
      const url = (data as { url?: unknown } | undefined)?.url;
      if (typeof url === 'string' && url.startsWith('/trips/')) router.push(url as never);
    };
    void notifications().then(async (N) => {
      const last = await N.getLastNotificationResponseAsync();
      if (last) open(last.notification.request.content.data);
      subscription = N.addNotificationResponseReceivedListener((r) =>
        open(r.notification.request.content.data),
      );
    });
    return () => subscription?.remove();
  }, []);
}
