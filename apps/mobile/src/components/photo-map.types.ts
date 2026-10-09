import type { Photo, Place } from '@tagalong/shared';

/** What both versions of the map take: the real one on phones, the list in a browser. */
export interface PhotoMapProps {
  places: Place[];
  photosById: Map<string, Photo>;
  onOpenPlace: (place: Place) => void;
}
