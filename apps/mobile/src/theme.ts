import * as SecureStore from 'expo-secure-store';
import { Appearance, Platform } from 'react-native';
import { dark, light } from './palette';

// Tokens taken from the design canvas (Group Trip App UX Flow), in a light and a dark look.

export type AppearanceChoice = 'system' | 'light' | 'dark';
export const APPEARANCE_KEY = 'tagalong.appearance';

/** The look chosen in Profile → Appearance, read once, before any styles are made. */
const readChoice = (): AppearanceChoice => {
  try {
    const value = Platform.OS === 'web' ? window.localStorage.getItem(APPEARANCE_KEY) : SecureStore.getItem(APPEARANCE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
};

export const appearanceChoice = readChoice();

/**
 * Light or dark, decided when the app starts. Styles are made once, at
 * import, so changing it takes a quick restart (Profile does that), which
 * keeps every StyleSheet.create as it is.
 */
export const scheme: 'light' | 'dark' =
  appearanceChoice === 'system' ? (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light') : appearanceChoice;

// Native pieces (switches, the keyboard, alerts) follow the chosen look too.
if (appearanceChoice !== 'system' && Platform.OS !== 'web') Appearance.setColorScheme(appearanceChoice);

export const colors = scheme === 'dark' ? dark : light;

/** Member avatar colors, assigned in the order people joined. */
export const avatarColors = ['#0E6B5C', '#B54A28', '#5B4E86', '#7A5F14', '#3F6E8C', '#8A3D5C'] as const;
export const avatarColor = (index: number) => avatarColors[index % avatarColors.length]!;

export const coverColors =['#D8A47F', '#8FA6A0', '#6F8A99', '#7E8C6B'] as const;

export const fonts = {
  display: 'Fraunces_600SemiBold',
  body: 'DMSans_400Regular',
  medium: 'DMSans_500Medium',
  bold: 'DMSans_600SemiBold',
} as const;

export const radius = { sm: 10, md: 14, lg: 18, xl: 22, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
