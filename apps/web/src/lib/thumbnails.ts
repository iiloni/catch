import type { AttachmentKind } from '@catch/shared';

/** The longest side of a thumbnail, as the server makes them for other notes. */
const THUMBNAIL_SIZE = 720;
const VIDEO_WAIT_MS = 10_000;

type Drawable = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function imageSource(file: Blob): Promise<Drawable> {
  const bitmap = await createImageBitmap(file);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    close: () => bitmap.close(),
  };
}

/** The first frame of a video the browser can play. */
function videoSource(file: Blob): Promise<Drawable> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  const close = () => {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  return new Promise<Drawable>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Timed out')), VIDEO_WAIT_MS);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve({ source: video, width: video.videoWidth, height: video.videoHeight, close });
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Unsupported video'));
    };
    video.src = url;
  }).catch((error) => {
    close();
    throw error;
  });
}

/**
 * A thumbnail made on the device, for a file the server cannot read (ADR 0020). Null when
 * the browser cannot decode the file; the note then shows it without one.
 */
export async function makeThumbnail(file: Blob, kind: AttachmentKind): Promise<Blob | null> {
  if (kind !== 'image' && kind !== 'video') return null;
  let drawable: Drawable | null = null;
  try {
    drawable = await (kind === 'image' ? imageSource(file) : videoSource(file));
    if (!drawable.width || !drawable.height) return null;
    const scale = Math.min(1, THUMBNAIL_SIZE / Math.max(drawable.width, drawable.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(drawable.width * scale));
    canvas.height = Math.max(1, Math.round(drawable.height * scale));
    canvas.getContext('2d')?.drawImage(drawable.source, 0, 0, canvas.width, canvas.height);
    // A browser that cannot write WebP answers with a PNG, which shows just as well.
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
  } catch {
    return null;
  } finally {
    drawable?.close();
  }
}
