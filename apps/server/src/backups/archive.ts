import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { backupKindSchema } from '@catch/shared';
import { z } from 'zod';
import { BackupError } from './errors';
import { readZip, type ZipEntry, ZipWriter } from './zip';

/**
 * A backup is a zip of the database dump, the attachment files, and a manifest naming every
 * file with its size and SHA-256. The manifest is written last, once the files it describes
 * have been read, and is what makes a zip a Catch backup.
 */
export const MANIFEST = 'manifest.json';
export const DATABASE = 'database.dump';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ATTACHMENT_MEMBER = new RegExp(`^attachments/(${UUID})$`, 'i');
// Originals only: previews (`<id>.webp`) are made again on request, and `.tmp` files are
// uploads still arriving.
const ATTACHMENT_FILE = new RegExp(`^${UUID}$`, 'i');
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;

const fileSchema = z.object({
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const databaseInfoSchema = z.object({
  postgres: z.string(),
  migrations: z.number().int().nonnegative(),
  /** When the newest applied migration was generated, to refuse a backup from a newer Catch. */
  latestMigration: z.number().int().nullable(),
  users: z.number().int().nonnegative(),
  notes: z.number().int().nonnegative(),
  attachments: z.number().int().nonnegative(),
});
export type DatabaseInfo = z.infer<typeof databaseInfoSchema>;

export const manifestSchema = z.object({
  format: z.literal('catch-backup'),
  formatVersion: z.literal(1),
  createdAt: z.iso.datetime(),
  kind: backupKindSchema.exclude(['upload']),
  appVersion: z.string().nullable(),
  secretFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  database: databaseInfoSchema,
  attachments: z.object({
    included: z.boolean(),
    count: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative(),
  }),
  files: z.record(z.string(), fileSchema),
});
export type Manifest = z.infer<typeof manifestSchema>;

/**
 * Identifies the server secret a backup was made under without revealing it. Sessions are
 * signed with the secret, so restoring under another one signs everyone out.
 */
export function secretFingerprint(secret: string) {
  return createHash('sha256').update(`catch-backup:${secret}`).digest('hex');
}

export type AttachmentFile = { id: string; size: number };

export async function listAttachmentFiles(dir: string): Promise<AttachmentFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const files: AttachmentFile[] = [];
  for (const name of names.filter((candidate) => ATTACHMENT_FILE.test(candidate)).sort()) {
    const info = await stat(join(dir, name)).catch(() => null);
    if (info?.isFile()) files.push({ id: name, size: info.size });
  }
  return files;
}

type ArchiveInput = Pick<Manifest, 'kind' | 'appVersion' | 'database'> & {
  createdAt: Date;
  secret: string;
  dumpFile: string;
  /** Null leaves the files out: a database-only backup. */
  attachments: { dir: string; files: readonly AttachmentFile[] } | null;
};

/** Writes a backup to `path`, which must not exist. The caller removes it on failure. */
export async function writeArchive(path: string, input: ArchiveInput): Promise<Manifest> {
  const writer = await ZipWriter.create(path);
  try {
    const files: Manifest['files'] = {};
    const add = async (member: string, source: string, size: number) => {
      const handle = await open(source, 'r');
      try {
        files[member] = await writer.add(member, size, handle.createReadStream());
      } finally {
        await handle.close().catch(() => {});
      }
    };

    await add(DATABASE, input.dumpFile, (await stat(input.dumpFile)).size);
    let count = 0;
    let bytes = 0;
    for (const file of input.attachments?.files ?? []) {
      try {
        await add(`attachments/${file.id}`, join(input.attachments!.dir, file.id), file.size);
      } catch (error) {
        // Removed since the directory was listed: the database dump may still name it, and a
        // restore reports it as missing.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      count += 1;
      bytes += file.size;
    }

    const manifest: Manifest = {
      format: 'catch-backup',
      formatVersion: 1,
      createdAt: input.createdAt.toISOString(),
      kind: input.kind,
      appVersion: input.appVersion,
      secretFingerprint: secretFingerprint(input.secret),
      database: input.database,
      attachments: { included: input.attachments !== null, count, bytes },
      files,
    };
    const encoded = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    await writer.add(MANIFEST, encoded.length, [encoded]);
    await writer.finish();
    return manifest;
  } catch (error) {
    await writer.abort();
    throw error;
  }
}

export type Archive = { manifest: Manifest; entries: Map<string, ZipEntry> };

const NOT_A_BACKUP = 'This file is not a Catch backup.';

/** Reads a backup's manifest and checks it against the files in the archive, unread. */
export async function openArchive(path: string): Promise<Archive> {
  const entries = new Map<string, ZipEntry>();
  for (const entry of await readZip(path)) {
    if (entries.has(entry.name)) throw new BackupError('The backup is damaged.');
    entries.set(entry.name, entry);
  }
  const member = entries.get(MANIFEST);
  if (!member || member.size > MAX_MANIFEST_BYTES) throw new BackupError(NOT_A_BACKUP);

  const chunks: Buffer[] = [];
  for await (const chunk of await member.open()) chunks.push(chunk as Buffer);
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BackupError(NOT_A_BACKUP);
  }
  const format = z.object({ format: z.literal('catch-backup'), formatVersion: z.number() });
  const header = format.safeParse(json);
  if (!header.success) throw new BackupError(NOT_A_BACKUP);
  if (header.data.formatVersion !== 1) {
    throw new BackupError('This backup was made by a newer version of Catch.');
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) throw new BackupError('The backup’s manifest is damaged.');
  const manifest = parsed.data;

  if (
    !Object.hasOwn(manifest.files, DATABASE) ||
    entries.size !== Object.keys(manifest.files).length + 1
  ) {
    throw new BackupError('The backup is damaged: its files do not match its manifest.');
  }
  for (const [name, file] of Object.entries(manifest.files)) {
    const attachment = ATTACHMENT_MEMBER.test(name);
    if (
      (name !== DATABASE && !attachment) ||
      (attachment && !manifest.attachments.included) ||
      entries.get(name)?.size !== file.size
    ) {
      throw new BackupError('The backup is damaged: its files do not match its manifest.');
    }
  }
  return { manifest, entries };
}

/** Hashes a stream on its way through. */
function hasher() {
  const hash = createHash('sha256');
  const stream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  return { stream, digest: () => hash.digest('hex') };
}

async function checksum(entry: ZipEntry) {
  const hash = createHash('sha256');
  for await (const chunk of await entry.open()) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Reads every file in a backup against its checksum. Catches a truncated or altered archive. */
export async function verifyArchive(path: string): Promise<Archive> {
  const archive = await openArchive(path);
  for (const [name, file] of Object.entries(archive.manifest.files)) {
    if ((await checksum(archive.entries.get(name)!)) !== file.sha256) {
      throw new BackupError(`The backup is damaged: ${name} does not match its checksum.`);
    }
  }
  return archive;
}

/** Copies a file out of a backup, checking it on the way, and only then puts it in place. */
export async function extractFile(
  archive: Archive,
  name: string,
  destination: string,
  mode = 0o600,
) {
  const entry = archive.entries.get(name);
  const expected = archive.manifest.files[name];
  if (!entry || !expected) throw new BackupError(`The backup has no ${name}.`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  const { stream, digest } = hasher();
  try {
    await pipeline(await entry.open(), stream, createWriteStream(temporary, { mode }));
    if (digest() !== expected.sha256) {
      throw new BackupError(`The backup is damaged: ${name} does not match its checksum.`);
    }
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Puts a backup's attachment files back, skipping ones already here: an attachment's bytes
 * never change once uploaded. Files the backup does not hold are left alone, so the
 * database from before the restore still has its files.
 */
export async function extractAttachments(archive: Archive, dir: string) {
  await mkdir(dir, { recursive: true });
  let restored = 0;
  for (const [name, file] of Object.entries(archive.manifest.files)) {
    const id = ATTACHMENT_MEMBER.exec(name)?.[1];
    if (!id) continue;
    const destination = join(dir, id);
    const existing = await stat(destination).catch(() => null);
    if (existing?.isFile() && existing.size === file.size) continue;
    await extractFile(archive, name, destination, 0o644);
    restored += 1;
  }
  return restored;
}
