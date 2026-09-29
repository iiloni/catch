import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { db } from '../db/client';
import { linkPreviewAssets } from '../db/schema';
import { dominantHue } from './colors';
import { safeFetch } from './safeFetch';

/** Thumbnails fit this box: enough for a full-width card on a phone at 2x. */
const THUMBNAIL_SIZE = 720;
const ICON_SIZE = 64;
/** Refuses decompression bombs: a few kilobytes that decode to a huge canvas. */
const MAX_INPUT_PIXELS = 40_000_000;

export type StoredImage = { hash: string; width: number; height: number };

async function store(data: Buffer, contentType: string) {
  const hash = createHash('sha256').update(data).digest('hex');
  await db.insert(linkPreviewAssets).values({ hash, contentType, data }).onConflictDoNothing();
  return hash;
}

function decode(input: Buffer) {
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
}

/** Downloads a page's image and stores it as a WebP thumbnail. Null if it is unusable. */
export async function fetchThumbnail(url: string): Promise<StoredImage | null> {
  const { body } = await safeFetch(url, { maxBytes: 8 * 1024 * 1024, accept: ['image/'] });
  const { data, info } = await decode(body)
    // Respect EXIF orientation before the metadata is dropped.
    .rotate()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  // Tracking pixels and spacers are not thumbnails.
  if (info.width < 48 || info.height < 48) return null;
  return { hash: await store(data, 'image/webp'), width: info.width, height: info.height };
}

/**
 * The PNG images inside an ICO file, largest first. Most modern favicons embed PNGs, which
 * sharp can read; older bitmap entries are skipped.
 */
export function icoPngs(ico: Buffer): Buffer[] {
  if (ico.length < 6 || ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) return [];
  const count = ico.readUInt16LE(4);
  const entries: Array<{ size: number; data: Buffer }> = [];
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    if (at + 16 > ico.length) break;
    const width = ico.readUInt8(at) || 256;
    const length = ico.readUInt32LE(at + 8);
    const offset = ico.readUInt32LE(at + 12);
    if (offset + length > ico.length) continue;
    const data = ico.subarray(offset, offset + length);
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      entries.push({ size: width, data });
    }
  }
  return entries.sort((a, b) => b.size - a.size).map((entry) => entry.data);
}

export type StoredIcon = { hash: string; hue: number | null };

/** Downloads a site icon, stores it as a small PNG and finds its color. */
export async function fetchIcon(url: string): Promise<StoredIcon | null> {
  const { body } = await safeFetch(url, {
    maxBytes: 1024 * 1024,
    accept: ['image/', 'application/octet-stream', 'text/plain'],
    timeoutMs: 6000,
  });
  const sources = [body, ...icoPngs(body)];
  for (const source of sources) {
    try {
      const icon = decode(source).resize(ICON_SIZE, ICON_SIZE, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
      const png = await icon.clone().png().toBuffer();
      const pixels = await icon.clone().resize(24, 24).ensureAlpha().raw().toBuffer();
      return { hash: await store(png, 'image/png'), hue: dominantHue(pixels) };
    } catch {
      // Not an image sharp reads (an ICO of bitmaps, say); try the next source.
    }
  }
  return null;
}
