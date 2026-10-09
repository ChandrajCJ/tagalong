import { newId, parseExif, Photo, PhotoUpload, type PhotoFacts } from '@tagalong/shared';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { ApiError, request } from './api';
import { MONTH_NAMES, parseIso } from './dates';
import { weekdayOf } from './plan';

/** Sharp on any phone screen, and roughly five times less data than the original. */
const MAX_EDGE = 2560;
/** Uploads at once: enough to keep the connection busy, few enough not to choke it. */
const PARALLEL = 3;

/** A picked photo, converted and ready to send. */
interface Prepared {
  blob: Blob;
  width: number;
  height: number;
  facts: PhotoFacts;
}

/**
 * Every photo leaves the phone as a JPEG no wider than MAX_EDGE. That's not
 * just to save data: iPhones shoot HEIC, which the server's image library
 * can't read, so without this an iPhone photo would never get a thumbnail.
 */
const prepare = async (asset: ImagePickerAsset): Promise<Prepared> => {
  // Read the EXIF before converting: re-encoding drops it.
  const facts = parseExif(asset.exif as Record<string, unknown> | null | undefined);

  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  const blob = await fetch(saved.uri).then((r) => r.blob());
  return { blob, width: saved.width, height: saved.height, facts };
};

/** Link, bytes, confirm: the same three steps as documents. */
const sendOne = async (tripId: string, batchId: string, asset: ImagePickerAsset, id: string) => {
  const { blob, width, height, facts } = await prepare(asset);
  const { uploadUrl } = await request(`/trips/${tripId}/photos`, {
    method: 'POST',
    body: {
      id,
      batchId,
      contentType: 'image/jpeg',
      sizeBytes: blob.size,
      width,
      height,
      ...facts,
    },
    schema: PhotoUpload,
  });
  const sent = await fetch(uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'content-type': 'image/jpeg' },
  });
  if (!sent.ok) throw new ApiError(sent.status, 'upload_failed', "That photo didn't upload");
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
