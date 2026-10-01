import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  access,
  chmod,
  constants,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import {
  type BackupItem,
  type BackupKind,
  type BackupOverview,
  backupFileName,
  backupScheduleSchema,
  DEFAULT_BACKUP_SCHEDULE,
  parseBackupFileName,
} from '@catch/shared';
import { z } from 'zod';
import { openArchive, secretFingerprint, verifyArchive } from './archive';
import { BackupError } from './errors';
import { latestKnownMigration } from './postgres';

/** Where a server's state lives and what its backups are checked against. */
export type BackupConfig = {
  databaseUrl: string;
  attachmentsDir: string;
  backupsDir: string;
  migrationsFolder: string;
  secret: string;
  appVersion: string | null;
};

const WORK = '.tmp';
const SCHEDULE = 'schedule.json';
const STALE_WORK_MS = 6 * 60 * 60 * 1000;

/**
 * A private directory for one operation's intermediate files, inside the backups directory
 * so a finished archive moves into place with a rename. The caller removes it.
 */
export async function workDir(backupsDir: string) {
  const dir = join(backupsDir, WORK, randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Removes what an interrupted backup or restore left behind. */
export async function clearStaleWork(backupsDir: string, now = Date.now()) {
  const root = join(backupsDir, WORK);
  for (const name of await readdir(root).catch(() => [])) {
    const info = await stat(join(root, name)).catch(() => null);
    if (info && now - info.mtimeMs > STALE_WORK_MS) {
      await rm(join(root, name), { recursive: true, force: true });
    }
  }
}

/** The path of a backup by name. Names that are not backup file names never reach the disk. */
export function backupPath(backupsDir: string, name: string) {
  if (!parseBackupFileName(name)) throw new BackupError('There is no such backup.');
  return join(backupsDir, name);
}

/** A name for a new backup that no file has yet. */
export async function freeBackupName(backupsDir: string, kind: BackupKind, createdAt: Date) {
  for (let copy = 0; ; copy++) {
    const name = backupFileName(kind, createdAt, copy);
    if (!existsSync(join(backupsDir, name))) return name;
  }
}

const described = new Map<string, { size: number; mtimeMs: number; item: BackupItem }>();

/**
 * What the admin sees of one backup. Its kind and time come from the file name, which is
 * what retention goes by; the rest from its manifest, read once per file.
 */
export async function describeBackup(config: BackupConfig, name: string): Promise<BackupItem> {
  const path = backupPath(config.backupsDir, name);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new BackupError('There is no such backup.');
  const cached = described.get(name);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.item;

  const named = parseBackupFileName(name)!;
  let item: BackupItem;
  try {
    const { manifest } = await openArchive(path);
    const known = await latestKnownMigration(config.migrationsFolder);
    item = {
      name,
      kind: named.kind,
      createdAt: manifest.createdAt,
      size: info.size,
      appVersion: manifest.appVersion,
      users: manifest.database.users,
      notes: manifest.database.notes,
      includesAttachments: manifest.attachments.included,
      attachments: manifest.attachments.count,
      secretMatches: manifest.secretFingerprint === secretFingerprint(config.secret),
      problem:
        (manifest.database.latestMigration ?? 0) > known
          ? 'Made by a newer version of Catch. Update Catch to restore it.'
          : null,
    };
  } catch (error) {
    if (!(error instanceof BackupError)) throw error;
    item = {
      name,
      kind: named.kind,
      createdAt: named.createdAt.toISOString(),
      size: info.size,
      appVersion: null,
      users: 0,
      notes: 0,
      includesAttachments: false,
      attachments: 0,
      secretMatches: true,
      problem: error.message,
    };
  }
  described.set(name, { size: info.size, mtimeMs: info.mtimeMs, item });
  return item;
}

async function backupNames(backupsDir: string) {
  const names = await readdir(backupsDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter((name) => parseBackupFileName(name));
}

/** The backups in the directory, newest first. */
export async function listBackups(config: BackupConfig): Promise<BackupItem[]> {
  const names = await backupNames(config.backupsDir);
  for (const name of described.keys()) if (!names.includes(name)) described.delete(name);
  const items: BackupItem[] = [];
  for (const name of names) {
    // A file removed between the listing and the read is simply gone.
    const item = await describeBackup(config, name).catch(() => null);
    if (item) items.push(item);
  }
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteBackup(backupsDir: string, name: string) {
  const path = backupPath(backupsDir, name);
  if (!existsSync(path)) throw new BackupError('There is no such backup.');
  await rm(path);
}

/**
 * Keeps the newest `keep` backups of one kind and removes the older ones. Other kinds are
 * never touched, so a scheduled backup's retention cannot delete one made by hand.
 */
export async function pruneBackups(backupsDir: string, kind: BackupKind, keep: number) {
  const names = (await backupNames(backupsDir))
    .filter((name) => parseBackupFileName(name)?.kind === kind)
    .sort()
    .reverse();
  const removed = names.slice(Math.max(0, keep));
  for (const name of removed) await rm(join(backupsDir, name), { force: true });
  return removed;
}

/**
 * Takes in an archive from elsewhere (an upload, or a file given to the CLI) once every file
 * in it matches its checksum. `source` must be on the backups directory's file system.
 */
export async function importBackup(config: BackupConfig, source: string) {
  const { manifest } = await verifyArchive(source);
  const name = await freeBackupName(config.backupsDir, 'upload', new Date(manifest.createdAt));
  await chmod(source, 0o600);
  await rename(source, join(config.backupsDir, name));
  return name;
}

/** Whether a directory is a mount of its own: in a container, a volume rather than its layer. */
async function isMountPoint(dir: string) {
  try {
    const target = await realpath(dir);
    const mounts = await readFile('/proc/self/mountinfo', 'utf8');
    return mounts.split('\n').some((line) => line.split(' ')[4] === target);
  } catch {
    return true;
  }
}

export async function destinationStatus(
  config: BackupConfig,
): Promise<BackupOverview['destination']> {
  await mkdir(config.backupsDir, { recursive: true, mode: 0o700 }).catch(() => {});
  const space = await statfs(config.backupsDir).catch(() => null);
  const writable = await access(config.backupsDir, constants.W_OK).then(
    () => true,
    () => false,
  );
  const [backups, data] = await Promise.all(
    [config.backupsDir, config.attachmentsDir].map((dir) => stat(dir).catch(() => null)),
  );
  return {
    freeBytes: space && writable ? space.bavail * space.bsize : null,
    sameDiskAsData: Boolean(backups && data && backups.dev === data.dev),
    // Outside a container the directory is as lasting as any other.
    persistent: !existsSync('/.dockerenv') || (await isMountPoint(config.backupsDir)),
  };
}

const scheduleStateSchema = z.object({
  schedule: backupScheduleSchema,
  /** The local date of the last scheduled run, so each day's backup runs once. */
  lastRunDate: z.string().nullable(),
});
export type ScheduleState = z.infer<typeof scheduleStateSchema>;

/**
 * The schedule lives beside the backups rather than in the database, so restoring a backup
 * does not put back the schedule of the day it was made.
 */
export async function readSchedule(backupsDir: string): Promise<ScheduleState> {
  try {
    return scheduleStateSchema.parse(
      JSON.parse(await readFile(join(backupsDir, SCHEDULE), 'utf8')),
    );
  } catch {
    return { schedule: DEFAULT_BACKUP_SCHEDULE, lastRunDate: null };
  }
}

export async function writeSchedule(backupsDir: string, state: ScheduleState) {
  await mkdir(backupsDir, { recursive: true, mode: 0o700 });
  const temporary = join(backupsDir, `.${SCHEDULE}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, join(backupsDir, SCHEDULE));
}
