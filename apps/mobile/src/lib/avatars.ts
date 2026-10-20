import { Me, type TripMember } from '@tagalong/shared';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createContext, useContext } from 'react';
import { z } from 'zod';
import { request } from './api';
import { localFileSize, putFile } from './upload';

/** A profile photo's link, and the version that names it in the image cache. */
export interface AvatarPhoto {
  url: string;
  version: string;
}

/** Everyone's photos on the trip on screen, by user id, so any avatar can find its own. */
export const AvatarPhotos = createContext<Map<string, AvatarPhoto>>(new Map());

export const photosOf = (members: Pick<TripMember, 'userId' | 'avatarUrl' | 'avatarVersion'>[]) =>
  new Map(
    members.flatMap((m): [string, AvatarPhoto][] =>
      m.avatarUrl && m.avatarVersion ? [[m.userId, { url: m.avatarUrl, version: m.avatarVersion }]] : [],
    ),
  );

export const useAvatarPhoto = (userId: string | undefined) => {
  const photos = useContext(AvatarPhotos);
  return userId ? (photos.get(userId) ?? null) : null;
};

/** The edge of a profile photo, in pixels: plenty for the biggest avatar on screen. */
const SIZE = 512;

const Upload = z.object({ key: z.string(), uploadUrl: z.string().url() });

/**
 * Picks (or takes) a photo and crops it square on the phone, 512 px, as a
 * JPEG. The picker's own crop is used where there is one; the centre square
 * is taken otherwise (the web has none).
 */
export const pickAvatar = async (from: 'library' | 'camera'): Promise<string | null> => {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 };
  if (from === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Allow camera access to take a photo.');
  }
  const result = from === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  const side = Math.min(asset.width, asset.height);
  const context = ImageManipulator.manipulate(asset.uri);
  if (asset.width !== asset.height) {
    context.crop({ originX: (asset.width - side) / 2, originY: (asset.height - side) / 2, width: side, height: side });
  }
  context.resize({ width: SIZE, height: SIZE });
  const saved = await (await context.renderAsync()).saveAsync({ compress: 0.8, format: SaveFormat.JPEG });
  return saved.uri;
};

/** Uploads a prepared photo and makes it the profile photo. */
export const uploadAvatar = async (uri: string) => {
  const size = await localFileSize(uri);
  const upload = await request('/me/avatar', { method: 'POST', body: { contentType: 'image/jpeg', size }, schema: Upload });
  await putFile(upload.uploadUrl, uri, 'image/jpeg');
  return request('/me/avatar', { method: 'PUT', body: { key: upload.key }, schema: Me });
};

export const removeAvatar = () => request('/me/avatar', { method: 'DELETE', schema: Me });
