import * as Updates from 'expo-updates';
import { DevSettings, Platform } from 'react-native';
import { APPEARANCE_KEY, type AppearanceChoice } from '@/theme';
import { secureStorage } from './storage';

/**
 * Saves the look and restarts, since every screen's styles are made once at
 * start. On phones that's a quick reload of the app's code; on the web, of the page.
 */
export const chooseAppearance = async (choice: AppearanceChoice) => {
  await secureStorage.set(APPEARANCE_KEY, choice === 'system' ? null : choice);
  if (Platform.OS === 'web') return window.location.reload();
  try {
    await Updates.reloadAsync();
  } catch {
    // In development there's no update to reload; the dev menu's reload does the same.
    DevSettings.reload();
  }
};
