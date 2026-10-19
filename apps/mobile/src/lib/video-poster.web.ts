/** In the browser: play the file silently to half a second in, and draw that frame to a canvas. */
export const videoPoster = (uri: string): Promise<{ uri: string; width: number; height: number }> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = uri;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) =>
          blob ? resolve({ uri: URL.createObjectURL(blob), width: canvas.width, height: canvas.height }) : reject(new Error('No frame')),
        'image/jpeg',
        0.7,
      );
    };
    video.onerror = () => reject(new Error('That video couldn’t be read'));
  });

/** How long a picked file is, in milliseconds; the browser's picker doesn't say. */
export const videoDurationMs = (uri: string): Promise<number> =>
  new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = uri;
    video.onloadedmetadata = () => resolve(Math.round((video.duration || 0) * 1000));
    video.onerror = () => resolve(0);
  });
