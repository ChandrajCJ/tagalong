import { directionsLinks, placeQuery } from '@tagalong/shared';
import { Alert, Linking, Platform } from 'react-native';

/**
 * Opens directions to a place, with the destination already chosen. On
 * Android the Google link opens the Maps app; iPhones ask which app to use.
 */
export const openDirections = (place: string, destination?: string | null) => {
  const links = directionsLinks(placeQuery(place, destination));
  const go = (url: string) => void Linking.openURL(url).catch(() => undefined);
  if (Platform.OS !== 'ios') return go(links.google);
  Alert.alert('Get directions', place, [
    { text: 'Apple Maps', onPress: () => go(links.apple) },
    { text: 'Google Maps', onPress: () => go(links.google) },
    { text: 'Cancel', style: 'cancel' },
  ]);
};
