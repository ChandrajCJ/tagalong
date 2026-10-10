import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small, private key-value storage: the phone's keychain/keystore, or the
 * browser's localStorage on the web (which has no keychain), so the web app
 * stays signed in across reloads like the phone app does. Failures become
 * "nothing stored": the app then keeps state for this session only.
 */
const web = Platform.OS === 'web';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    try {
      return web ? window.localStorage.getItem(key) : await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null): Promise<void> {
    try {
      if (web) {
        if (value === null) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
      } else if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // Kept in memory for this session instead.
    }
  },
};
