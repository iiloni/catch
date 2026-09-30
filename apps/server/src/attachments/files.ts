import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MAX_ATTACHMENT_BYTES } from '@catch/shared';
import sharp from 'sharp';
import { env } from '../env';

export const filePath = (id: string, preview = false) =>
  join(env.ATTACHMENTS_DIR, `${id}${preview ? '.webp' : ''}`);

export class UploadError extends Error {}

/** A temporary file keeps partial uploads invisible and bounds memory independently of size. */
export async function storeFile(id: string, body: ReadableStream<Uint8Array>, expected: number) {
  await mkdir(env.ATTACHMENTS_DIR, { recursive: true });
  const temporary = join(env.ATTACHMENTS_DIR, `${id}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx');
  let size = 0;
  try {
    const reader = body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > expected || size > MAX_ATTACHMENT_BYTES)
          throw new UploadError('File is too large');
        await handle.writeFile(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (size !== expected) throw new UploadError('File size does not match');
    await handle.close();
    await rename(temporary, filePath(id));
  } catch (error) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function createThumbnail(id: string) {
  try {
    await sharp(filePath(id), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(filePath(id, true));
  } catch {
    // Unsupported image formats still have their original available to download.
    await rm(filePath(id, true), { force: true });
  }
}

export async function deleteFiles(ids: readonly string[]) {
  await Promise.all(
    ids.flatMap((id) => [false, true].map((preview) => rm(filePath(id, preview), { force: true }))),
  );
}

/** Supports seeking without reading a whole recording into server memory. */
export function parseRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size < 1) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    start < size
    ? { start, end }
    : null;
}

export async function fileResponse(
  id: string,
  preview: boolean,
  mimeType: string,
  name: string,
  range?: string,
  download = false,
) {
  const path = filePath(id, preview);
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const headers = new Headers({
    'content-type': preview ? 'image/webp' : mimeType,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox",
    'accept-ranges': 'bytes',
    'content-disposition': `${download || (!preview && !/^(image|video|audio)\//.test(mimeType)) ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, '%27')}`,
  });
  const selected = range ? parseRange(range, size) : null;
  if (range && !selected) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-length', String(selected ? selected.end - selected.start + 1 : size));
  if (selected) headers.set('content-range', `bytes ${selected.start}-${selected.end}/${size}`);
  const stream = Readable.toWeb(
    createReadStream(path, selected ?? {}),
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, { status: selected ? 206 : 200, headers });
}
