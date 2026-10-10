import { newId, parseExif, Photo, PhotoUpload, type PhotoFacts } from '@tagalong/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { PermissionsAndroid, Platform } from 'react-native';
import { request } from './api';
import { MONTH_NAMES, parseIso } from './dates';
import { weekdayOf } from './plan';
import { localFileSize, putFile } from './upload';

/** Sharp on any phone screen, and roughly five times less data than the original. */
const MAX_EDGE = 2560;
/** Uploads at once: enough to keep the connection busy, few enough not to choke it. */
const PARALLEL = 3;

/** A picked photo, converted and ready to send. */
interface Prepared {
  uri: string;
  size: number;
  width: number;
  height: number;
  facts: PhotoFacts;
}

/** "2026-06-12T18:30:00" for an instant, on this phone's clock. */
const localStamp = (ms: number) => {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// Asked once per app session, however many photos are picked at once.
let libraryPermission: Promise<boolean> | null = null;

/**
 * Read access to the library, plus, on Android 10 and later, the separate
 * "photo locations" permission: without it Android blanks the GPS of every
 * photo it hands to an app. The app declares it (app.json); asking here
 * shows the prompt where the system supports it, and is harmless where not.
 */
const askLibraryAccess = async () => {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 29) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION, {
      title: 'Put your photos on the map',
      message: 'Tagalong reads where each photo was taken so the group can see them on the trip map.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    }).catch(() => undefined);
  }
  const { granted } = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  return granted;
};

/**
 * When and where, from the phone's photo library instead of the file.
 * Android's photo picker strips the location from what it hands over, for
 * privacy, so the EXIF has none; the library still knows it, given access.
 * Best effort: any failure just means no location.
 */
const libraryFacts = async (assetId: string): Promise<Partial<PhotoFacts>> => {
  if (Platform.OS === 'web') return {};
  try {
    libraryPermission ??= askLibraryAccess();
    if (!(await libraryPermission)) return {};
    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    // Run the coordinates through the EXIF reader, so "0,0" and nonsense are refused the same way.
    const located = info.location
      ? parseExif({ GPSLatitude: info.location.latitude, GPSLongitude: info.location.longitude })
      : null;
    return {
      takenAt: info.creationTime ? localStamp(info.creationTime) : null,
      latitude: located?.latitude ?? null,
      longitude: located?.longitude ?? null,
    };
  } catch {
    return {};
  }
};

/**
 * Every photo leaves the phone as a JPEG no wider than MAX_EDGE. That's not
 * just to save data: iPhones shoot HEIC, which the server's image library
 * can't read, so without this an iPhone photo would never get a thumbnail.
 */
const prepare = async (asset: ImagePickerAsset): Promise<Prepared> => {
  // Read the EXIF before converting: re-encoding drops it.
  const exif = parseExif(asset.exif as Record<string, unknown> | null | undefined);
  const needsLibrary = exif.latitude === null || exif.takenAt === null;
  const library = needsLibrary && asset.assetId ? await libraryFacts(asset.assetId) : {};
  const facts: PhotoFacts = {
    // The camera's own clock wins; the library's is the fallback.
    takenAt: exif.takenAt ?? library.takenAt ?? null,
    latitude: exif.latitude ?? library.latitude ?? null,
    longitude: exif.latitude !== null ? exif.longitude : (library.longitude ?? null),
  };

  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  // The size of the file actually being sent; the server checks it matches.
  const size = await localFileSize(saved.uri);
  return { uri: saved.uri, size, width: saved.width, height: saved.height, facts };
};

/** Link, bytes, confirm: the same three steps as documents. */
const sendOne = async (tripId: string, batchId: string, asset: ImagePickerAsset, id: string) => {
  const { uri, size, width, height, facts } = await prepare(asset);
  const { uploadUrl } = await request(`/trips/${tripId}/photos`, {
    method: 'POST',
    body: { id, batchId, contentType: 'image/jpeg', sizeBytes: size, width, height, ...facts },
    schema: PhotoUpload,
  });
  await putFile(uploadUrl, uri, 'image/jpeg');
  return request(`/photos/${id}/complete`, { method: 'POST', schema: Photo });
};

export interface UploadProgress {
  total: number;
  done: number;
  failed: { id: string; asset: ImagePickerAsset }[];
}

/**
 * Uploads a pick of photos a few at a time, reporting as it goes. Failures
 * are kept with their ids so a retry reuses the same row instead of making
 * a duplicate. When everything that can finish has, the chat gets one card.
 */
export const uploadBatch = async (
  tripId: string,
  picked: { id?: string; asset: ImagePickerAsset }[],
  onProgress: (progress: UploadProgress) => void,
  onPhoto: (photo: Photo) => void,
  batchId = newId(),
) => {
  const queue = picked.map((p) => ({ id: p.id ?? newId(), asset: p.asset }));
  const progress: UploadProgress = { total: queue.length, done: 0, failed: [] };
  onProgress({ ...progress });

  let next = 0;
  const lane = async () => {
    while (next < queue.length) {
      const job = queue[next++]!;
      try {
        onPhoto(await sendOne(tripId, batchId, job.asset, job.id));
        progress.done += 1;
      } catch {
        progress.failed.push(job);
      }
      onProgress({ ...progress, failed: [...progress.failed] });
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, lane));

  if (progress.done > 0) {
    await request(`/trips/${tripId}/photo-batches/${batchId}/finish`, { method: 'POST' }).catch(
      () => {},
    );
  }
  return { ...progress, batchId };
};

export interface DaySection {
  key: string;
  title: string;
  subtitle: string;
  /** Rows of up to three, for the grid. */
  data: Photo[][];
  count: number;
}

const chunk = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/** "Sat 13 Jun". */
export const dayLabel = (iso: string) => {
  const { month, day } = parseIso(iso);
  return `${weekdayOf(iso)} ${day} ${MONTH_NAMES[month]!.slice(0, 3)}`;
};

/**
 * The timeline: photos grouped by the day they were taken, as the clock read
 * where they were taken. Inside the trip's dates a day is "Day 2"; outside it
 * just gets its date. Photos the camera didn't date go last.
 */
export const groupByDay = (photos: Photo[], tripStart: string | null): DaySection[] => {
  const dated = new Map<string, Photo[]>();
  const undated: Photo[] = [];
  for (const photo of photos) {
    if (photo.takenAt) {
      const key = photo.takenAt.slice(0, 10);
      dated.set(key, [...(dated.get(key) ?? []), photo]);
    } else {
      undated.push(photo);
    }
  }

  const startMs = tripStart ? Date.parse(`${tripStart}T00:00:00Z`) : null;
  const sections: DaySection[] = [...dated.keys()].sort().map((key) => {
    const list = dated.get(key)!.sort((a, b) => a.takenAt!.localeCompare(b.takenAt!));
    const dayNumber =
      startMs !== null ? Math.round((Date.parse(`${key}T00:00:00Z`) - startMs) / 86_400_000) + 1 : null;
    return {
      key,
      title: dayNumber !== null && dayNumber >= 1 ? `Day ${dayNumber}` : dayLabel(key),
      subtitle: dayNumber !== null && dayNumber >= 1 ? dayLabel(key) : '',
      data: chunk(list, 3),
      count: list.length,
    };
  });

  if (undated.length > 0) {
    sections.push({
      key: 'undated',
      title: 'No date',
      subtitle: 'The camera didn’t record when',
      data: chunk(undated, 3),
      count: undated.length,
    });
  }
  return sections;
};

/** "Sat 12 Jun" or "Sat 12 – Mon 14 Jun", from photos' local times. */
export const dateSpan = (from: string | null, to: string | null) => {
  if (!from) return '';
  const a = dayLabel(from.slice(0, 10));
  if (!to || to.slice(0, 10) === from.slice(0, 10)) return a;
  return `${a} – ${dayLabel(to.slice(0, 10))}`;
};

/**
 * Saves full-size copies of photos to this phone's gallery, or downloads them
 * in a browser. Returns how many made it.
 */
export const savePhotos = async (
  list: Photo[],
  onProgress?: (done: number) => void,
): Promise<{ saved: number; failed: number }> => {
  let saved = 0;
  let failed = 0;
  if (Platform.OS !== 'web') {
    const { granted } = await MediaLibrary.requestPermissionsAsync(true);
    if (!granted) return { saved: 0, failed: list.length };
  }
  for (const photo of list) {
    try {
      if (!photo.url) throw new Error('No link');
      if (Platform.OS === 'web') {
        const blob = await (await fetch(photo.url)).blob();
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = `tagalong-${photo.id}.jpg`;
        a.click();
        URL.revokeObjectURL(href);
      } else {
        const FileSystem = await import('expo-file-system/legacy');
        const target = `${FileSystem.cacheDirectory}tagalong-${photo.id}.jpg`;
        const { uri } = await FileSystem.downloadAsync(photo.url, target);
        await MediaLibrary.saveToLibraryAsync(uri);
      }
      saved += 1;
    } catch {
      failed += 1;
    }
    onProgress?.(saved + failed);
  }
  return { saved, failed };
};
