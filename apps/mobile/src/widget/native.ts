import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';

/**
 * Whether this build has the widget's native part: Android builds from the
 * new APK do; Expo Go, older APKs, iPhones and the web don't. The library
 * throws as soon as it's imported without it, so it's only loaded after this.
 */
export const widgetsAvailable = () =>
  Platform.OS === 'android' && !!(TurboModuleRegistry.get('AndroidWidget') ?? NativeModules.AndroidWidget);
