import * as VideoThumbnails from 'expo-video-thumbnails';

/**
 * A still from half a second into the video, as a JPEG on the phone. It's
 * uploaded as the video's thumbnail, so the server never has to decode video.
 */
export const videoPoster = async (uri: string): Promise<{ uri: string; width: number; height: number }> => {
  const frame = await VideoThumbnails.getThumbnailAsync(uri, { time: 500, quality: 0.7 });
  return { uri: frame.uri, width: frame.width, height: frame.height };
};

/** The phone's picker already says how long a video is. */
export const videoDurationMs = async (_uri: string): Promise<number> => 0;
