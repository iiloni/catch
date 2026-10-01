import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DATABASE,
  extractAttachments,
  extractFile,
  listAttachmentFiles,
  openArchive,
  secretFingerprint,
  verifyArchive,
  writeArchive,
} from './archive';
import { ZipWriter } from './zip';

const PHOTO = '0199a0a0-0000-7000-8000-000000000001';
const VIDEO = '0199a0a0-0000-7000-8000-000000000002';
const database = {
  postgres: '17.5',
  migrations: 5,
  latestMigration: 1790793986632,
  users: 2,
  notes: 14,
  attachments: 2,
};

let dir: string;
let attachments: string;
let dumpFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catch-archive-'));
  attachments = join(dir, 'attachments');
  dumpFile = join(dir, 'dump');
  await mkdir(attachments);
  await writeFile(dumpFile, 'PGDMP pretend dump');
  await writeFile(join(attachments, PHOTO), 'photo bytes');
  await writeFile(join(attachments, VIDEO), 'video bytes, longer');
  // A preview and an upload still arriving, which a backup leaves out.
  await writeFile(join(attachments, `${PHOTO}.webp`), 'preview');
  await writeFile(join(attachments, `${VIDEO}.3f1c.tmp`), 'partial');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function write(name: string, withAttachments = true) {
  const path = join(dir, name);
  const manifest = await writeArchive(path, {
    kind: 'manual',
    createdAt: new Date('2026-10-01T03:00:00Z'),
    appVersion: '0.5.0',
    secret: 'a-secret',
    database,
    dumpFile,
    attachments: withAttachments
      ? { dir: attachments, files: await listAttachmentFiles(attachments) }
      : null,
  });
  return { path, manifest };
}

describe('backup archives', () => {
  it('hold the dump and the original attachment files, described by a manifest', async () => {
    const { path, manifest } = await write('full.zip');
    expect(manifest).toMatchObject({
      format: 'catch-backup',
      formatVersion: 1,
      createdAt: '2026-10-01T03:00:00.000Z',
      kind: 'manual',
      appVersion: '0.5.0',
      secretFingerprint: secretFingerprint('a-secret'),
      database,
      attachments: { included: true, count: 2, bytes: 30 },
    });
    expect(Object.keys(manifest.files)).toEqual([
      DATABASE,
      `attachments/${PHOTO}`,
      `attachments/${VIDEO}`,
    ]);
    expect((await verifyArchive(path)).manifest).toEqual(manifest);
  });

  it('can hold the database alone', async () => {
    const { path, manifest } = await write('database.zip', false);
    expect(manifest.attachments).toEqual({ included: false, count: 0, bytes: 0 });
    expect(Object.keys((await verifyArchive(path)).manifest.files)).toEqual([DATABASE]);
  });

  it('skip an attachment removed while the backup was being made', async () => {
    const files = await listAttachmentFiles(attachments);
    await rm(join(attachments, PHOTO));
    const path = join(dir, 'raced.zip');
    const manifest = await writeArchive(path, {
      kind: 'scheduled',
      createdAt: new Date(),
      appVersion: null,
      secret: 'a-secret',
      database,
      dumpFile,
      attachments: { dir: attachments, files },
    });
    expect(manifest.attachments.count).toBe(1);
    await verifyArchive(path);
  });

  it('do not reveal the secret they were made under', () => {
    expect(secretFingerprint('a-secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(secretFingerprint('a-secret')).not.toBe(secretFingerprint('another'));
  });

  it('are rejected when a file no longer matches its checksum', async () => {
    const { path } = await write('full.zip');
    const bytes = await readFile(path);
    const at = bytes.indexOf('photo bytes');
    bytes.write('PHOTO', at);
    await writeFile(path, bytes);
    // The sizes still match, so only reading the files tells.
    await openArchive(path);
    await expect(verifyArchive(path)).rejects.toThrow(/does not match its checksum/);
  });

  it('are told apart from other zip files', async () => {
    const path = join(dir, 'other.zip');
    const writer = await ZipWriter.create(path);
    await writer.add('notes.txt', 5, [Buffer.from('hello')]);
    await writer.finish();
    await expect(openArchive(path)).rejects.toThrow('This file is not a Catch backup.');
  });

  it('are rejected when the files are not the ones the manifest lists', async () => {
    const path = join(dir, 'extra.zip');
    const { manifest } = await write('full.zip');
    const writer = await ZipWriter.create(path);
    await writer.add(DATABASE, 18, [Buffer.from('PGDMP pretend dump')]);
    await writer.add('attachments/../../etc/passwd', 4, [Buffer.from('root')]);
    const encoded = Buffer.from(
      JSON.stringify({ ...manifest, files: { [DATABASE]: manifest.files[DATABASE] } }),
    );
    await writer.add('manifest.json', encoded.length, [encoded]);
    await writer.finish();
    await expect(openArchive(path)).rejects.toThrow(/do not match its manifest/);
  });

  it('restore attachment files that are missing and leave the rest alone', async () => {
    const { path } = await write('full.zip');
    const archive = await verifyArchive(path);
    await rm(join(attachments, PHOTO));
    await writeFile(join(attachments, 'newer-file'), 'uploaded since');

    expect(await extractAttachments(archive, attachments)).toBe(1);
    expect(await readFile(join(attachments, PHOTO), 'utf8')).toBe('photo bytes');
    expect(await readFile(join(attachments, 'newer-file'), 'utf8')).toBe('uploaded since');
    expect(await extractAttachments(archive, attachments)).toBe(0);

    const dump = join(dir, 'restored.dump');
    await extractFile(archive, DATABASE, dump);
    expect(await readFile(dump, 'utf8')).toBe('PGDMP pretend dump');
  });
});
