import { widgetSnapshot, type WidgetTrip, type WidgetView } from '@tagalong/shared';

/**
 * The widget's facts on the phone, saved by the app whenever it syncs and read
 * by the widget whenever it redraws. The widget never calls the API itself.
 */
export interface SavedSnapshot {
  savedAt: string;
  deviceZone: string;
  trips: WidgetTrip[];
}

const fileUri = async () => {
  const FileSystem = await import('expo-file-system/legacy');
  return { FileSystem, uri: `${FileSystem.documentDirectory}widget-snapshot.json` };
};

export const saveSnapshot = async (trips: WidgetTrip[]) => {
  const { FileSystem, uri } = await fileUri();
  const saved: SavedSnapshot = {
    savedAt: new Date().toISOString(),
    deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    trips,
  };
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(saved));
};

export const clearSnapshot = async () => {
  const { FileSystem, uri } = await fileUri();
  await FileSystem.deleteAsync(uri, { idempotent: true });
};

/** What to show right now, from the saved facts; nothing saved means nothing to show. */
export const currentView = async (now = new Date()): Promise<WidgetView> => {
  try {
    const { FileSystem, uri } = await fileUri();
    const saved = JSON.parse(await FileSystem.readAsStringAsync(uri)) as SavedSnapshot;
    return widgetSnapshot(saved.trips, now, saved.deviceZone);
  } catch {
    return { kind: 'none' };
  }
};
