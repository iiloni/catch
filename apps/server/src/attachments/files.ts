import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { type Attachment, MAX_ATTACHMENT_BYTES } from '@catch/shared';
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

const run = promisify(execFile);
const thumbnails = new Map<string, Promise<void>>();

/** Also repairs previews for attachments uploaded before video posters were supported. */
export function createThumbnail(id: string, kind: Attachment['kind']) {
  if (kind !== 'image' && kind !== 'video') return Promise.resolve();
  const active = thumbnails.get(id);
  if (active) return active;
  const task = generateThumbnail(id, kind).finally(() => thumbnails.delete(id));
  thumbnails.set(id, task);
  return task;
}

async function generateThumbnail(id: string, kind: 'image' | 'video') {
  const target = filePath(id, true);
  if (
    await stat(target).then(
      () => true,
      () => false,
    )
  )
    return;
  const temporary = join(env.ATTACHMENTS_DIR, `${id}.${randomUUID()}.webp`);
  try {
    if (kind === 'image') {
      await sharp(filePath(id), { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(720, 720, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(temporary);
    } else {
      // Accept direct media containers only: uploaded playlists must not fetch URLs or files.
      await run(
        'ffmpeg',
        [
          '-nostdin',
          '-hide_banner',
          '-loglevel',
          'error',
          '-protocol_whitelist',
          'file',
          '-format_whitelist',
          'mov,matroska,webm,avi,mpeg,mpegts,flv,ogg',
          '-threads',
          '1',
          '-i',
          filePath(id),
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-an',
          '-sn',
          '-vf',
          "scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease",
          '-c:v',
          'libwebp',
          '-quality',
          '80',
          '-threads',
          '1',
          '-f',
          'image2',
          '-update',
          '1',
          temporary,
        ],
        { timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 },
      );
    }
    await rename(temporary, target);
  } catch {
    // Unsupported media keeps its original available for playback or download.
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function deleteFiles(ids: readonly string[]) {
  // An in-flight preview must not reappear after its attachment is removed.
  await Promise.all(ids.map((id) => thumbnails.get(id)));
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

import { execFile } from 'node:child_process';
