import { FileSystemUploadType, getInfoAsync, uploadAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ApiError } from './api';

/*
 * Files on a phone are read and sent by the native uploader, never with
 * fetch(fileUri). On a real Android phone, fetch couldn't open the picked or
 * converted photo and answered with the text "File not found", which was then
 * uploaded in place of the photo: 14 bytes of error message where the picture
 * should be. The browser holds picked files in memory, where fetch is fine.
 */

/** The exact size in bytes of a local file, as it will be uploaded. */
export const localFileSize = async (uri: string): Promise<number> => {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new ApiError(0, 'file_missing', "That file couldn't be read");
    return (await res.blob()).size;
  }
  const info = await getInfoAsync(uri);
  if (!info.exists) throw new ApiError(0, 'file_missing', "That file isn't on the phone any more");
  return info.size;
};

/** Sends a local file to a signed storage link. Throws unless storage accepted it. */
export const putFile = async (url: string, uri: string, contentType: string) => {
  let status: number;
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    if (!res.ok) throw new ApiError(0, 'file_missing', "That file couldn't be read");
    const sent = await fetch(url, {
      method: 'PUT',
      body: await res.blob(),
      headers: { 'content-type': contentType },
    });
    status = sent.status;
  } else {
    const sent = await uploadAsync(url, uri, {
      httpMethod: 'PUT',
      uploadType: FileSystemUploadType.BINARY_CONTENT,
      // Must match the type the link was signed for, or storage refuses it.
      headers: { 'content-type': contentType },
    });
    status = sent.status;
  }
  if (status < 200 || status >= 300) {
    throw new ApiError(status, 'upload_failed', "The file didn't upload. Try again.");
  }
};
