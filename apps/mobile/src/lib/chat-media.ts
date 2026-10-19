import { MAX_CHAT_IMAGES, type ChatImage, type ChatMessage, type Photo } from '@tagalong/shared';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type PickedImage = ImagePicker.ImagePickerAsset & { key: string };

const keyed = (assets: ImagePicker.ImagePickerAsset[]): PickedImage[] =>
  assets.map((a, i) => ({ ...a, key: `${a.uri}-${Date.now()}-${i}` }));

/** Photos from the library for a chat message, up to the most one message can carry. */
export const pickFromLibrary = async (room: number): Promise<PickedImage[] | string> => {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return 'Allow photo access to send photos.';
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    videoMaxDuration: 60,
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, Math.min(room, MAX_CHAT_IMAGES)),
    exif: true,
    quality: 1,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  return result.canceled ? [] : keyed(result.assets.slice(0, room));
};

/** One photo straight from the camera. */
export const takePhoto = async (): Promise<PickedImage[] | string> => {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return 'Allow camera access to take a photo.';
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], exif: true, quality: 1 });
  return result.canceled ? [] : keyed(result.assets);
};

/** A pasted screenshot, in the browser: the clipboard's images, ready to send like picked ones. */
export const imagesFromPaste = async (event: ClipboardEvent): Promise<PickedImage[]> => {
  if (Platform.OS !== 'web') return [];
  const files = [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((f): f is File => !!f);
  const assets = await Promise.all(
    files.map(
      (file) =>
        new Promise<ImagePicker.ImagePickerAsset | null>((resolve) => {
          const uri = URL.createObjectURL(file);
          const img = new window.Image();
          img.onload = () => resolve({ uri, width: img.naturalWidth, height: img.naturalHeight, type: 'image' } as ImagePicker.ImagePickerAsset);
          img.onerror = () => resolve(null);
          img.src = uri;
        }),
    ),
  );
  return keyed(assets.filter((a): a is ImagePicker.ImagePickerAsset => !!a));
};

/** "2026-10-19T18:30:00" on this phone's clock, which is how the viewer shows a time. */
const localTime = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** A chat message's photos in the shape the full-screen viewer shows. */
export const asViewerPhotos = (message: ChatMessage): Photo[] =>
  message.images.map(
    (image: ChatImage): Photo => ({
      id: image.id,
      tripId: message.tripId,
      uploadedBy: message.senderId ?? image.id,
      uploaderName: message.senderName,
      batchId: image.id,
      contentType: image.kind === 'video' ? 'video/mp4' : 'image/jpeg',
      kind: image.kind,
      durationMs: image.durationMs,
      sizeBytes: null,
      width: image.width,
      height: image.height,
      takenAt: localTime(message.createdAt),
      latitude: null,
      longitude: null,
      status: 'ready',
      caption: message.body || null,
      source: image.inAlbum ? 'album' : 'chat',
      version: 1,
      createdAt: message.createdAt,
      favourites: 0,
      favourited: false,
      thumbUrl: image.thumbUrl,
      url: image.url,
    }),
  );
