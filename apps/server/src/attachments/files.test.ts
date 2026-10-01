import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../env';
import { createThumbnail, deleteFiles, filePath, fileResponse, parseRange } from './files';

describe('media thumbnails', () => {
  const originalDirectory = env.ATTACHMENTS_DIR;
  beforeEach(async () => {
    env.ATTACHMENTS_DIR = await mkdtemp(join(tmpdir(), 'catch-thumbnails-'));
  });
  afterEach(async () => {
    await rm(env.ATTACHMENTS_DIR, { recursive: true, force: true });
    env.ATTACHMENTS_DIR = originalDirectory;
  });

  // Generation and repair each allow FFmpeg up to ten seconds.
  it('generates a video poster and repairs a missing poster without changing the original', async () => {
    const id = randomUUID();
    const video = await readFile(new URL('../../../../e2e/fixtures/video.mp4', import.meta.url));
    await writeFile(filePath(id), video);
    await Promise.all([createThumbnail(id, 'video'), createThumbnail(id, 'video')]);
    expect(await sharp(filePath(id, true)).metadata()).toMatchObject({
      format: 'webp',
      width: 320,
      height: 180,
    });
    await rm(filePath(id, true));
    await createThumbnail(id, 'video');
    const response = await fileResponse(id, true, 'video/mp4', 'clip.mp4');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    await response.arrayBuffer();
    expect(await readFile(filePath(id))).toEqual(video);
    expect((await readdir(env.ATTACHMENTS_DIR)).sort()).toEqual([id, `${id}.webp`].sort());
    await deleteFiles([id]);
    expect(await readdir(env.ATTACHMENTS_DIR)).toEqual([]);
  }, 30_000);

  it('leaves unsupported videos downloadable without a partial poster', async () => {
    const id = randomUUID();
    await writeFile(filePath(id), 'invalid video');
    await createThumbnail(id, 'video');
    expect((await fileResponse(id, true, 'video/mp4', 'clip.mp4')).status).toBe(404);
    const response = await fileResponse(id, false, 'video/mp4', 'clip.mp4');
    expect(await response.text()).toBe('invalid video');
    expect(await readdir(env.ATTACHMENTS_DIR)).toEqual([id]);
  });
});

describe('media ranges', () => {
  it('supports bounded, open and suffix ranges', () => {
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(parseRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=2-99', 10)).toEqual({ start: 2, end: 9 });
  });
  it('rejects malformed, multiple and out-of-bounds ranges', () => {
    for (const value of [
      'bytes=-',
      'bytes=-0',
      'bytes=3-1',
      'bytes=10-',
      'bytes=0-2,3-5',
      'bytes=NaN-',
      'bytes=99999999999999999-',
    ])
      expect(parseRange(value, 10)).toBeNull();
    expect(parseRange('bytes=0-', 0)).toBeNull();
  });
});
