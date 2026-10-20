import { Platform, Share } from 'react-native';
import { request } from './api';

/**
 * "Download calendar (.ics)" for one trip: a file any calendar app opens.
 * The browser saves it; the phone offers it to the share sheet, where
 * Calendar, Files or an email can take it.
 */
export const downloadTripCalendar = async (tripId: string, tripName: string) => {
  const ics = (await request(`/trips/${tripId}/calendar.ics`, { text: true })) as string;
  const fileName = `${tripName.replace(/[^\w -]+/g, '').trim() || 'trip'}.ics`;

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');
  const uri = `${FileSystem.cacheDirectory}${encodeURIComponent(fileName)}`;
  await FileSystem.writeAsStringAsync(uri, ics);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/calendar', dialogTitle: fileName, UTI: 'com.apple.ical.ics' });
  } else {
    await Share.share({ message: ics });
  }
};
