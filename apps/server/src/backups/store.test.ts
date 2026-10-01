import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKUP_SCHEDULE } from '@catch/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder } from '../db/migrations';
import { writeArchive } from './archive';
import {
  type BackupConfig,
  backupPath,
  clearStaleWork,
  deleteBackup,
  describeBackup,
  freeBackupName,
  importBackup,
  listBackups,
  pruneBackups,
  readSchedule,
  workDir,
  writeSchedule,
} from './store';

let dir: string;
let config: BackupConfig;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'catch-store-'));
  config = {
    databaseUrl: 'postgres://unused',
    attachmentsDir: join(dir, 'attachments'),
    backupsDir: join(dir, 'backups'),
    migrationsFolder,
    secret: 'a-secret',
    appVersion: null,
  };
  await mkdir(config.backupsDir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function archive(path: string, { latestMigration = 1, secret = 'a-secret' } = {}) {
  const dumpFile = join(dir, 'dump');
  await writeFile(dumpFile, 'dump');
  await writeArchive(path, {
    kind: 'manual',
    createdAt: new Date('2026-09-30T10:00:00Z'),
    appVersion: '0.4.0',
    secret,
    database: {
      postgres: '17',
      migrations: 1,
      latestMigration,
      users: 1,
      notes: 3,
      attachments: 0,
    },
    dumpFile,
    attachments: null,
  });
}

const names = async () => (await readdir(config.backupsDir)).sort();

describe('the backups directory', () => {
  it('only reaches files named like backups', () => {
    expect(backupPath(config.backupsDir, 'catch-backup-2026-10-01_03-00-00-manual.zip')).toBe(
      join(config.backupsDir, 'catch-backup-2026-10-01_03-00-00-manual.zip'),
    );
    for (const name of ['../secrets', 'schedule.json', '/etc/passwd', '']) {
      expect(() => backupPath(config.backupsDir, name)).toThrow('There is no such backup.');
    }
  });

  it('lists backups newest first with what their manifests say', async () => {
    await archive(join(config.backupsDir, 'catch-backup-2026-09-30_10-00-00-manual.zip'));
    await writeFile(join(config.backupsDir, 'catch-backup-2026-10-01_03-00-00-scheduled.zip'), 'x');
    await writeFile(join(config.backupsDir, 'unrelated.txt'), 'x');

    const backups = await listBackups(config);
    expect(backups.map((backup) => backup.name)).toEqual([
      'catch-backup-2026-10-01_03-00-00-scheduled.zip',
      'catch-backup-2026-09-30_10-00-00-manual.zip',
    ]);
    // A file that is not an archive is still listed, so it can be seen and removed.
    expect(backups[0]).toMatchObject({ kind: 'scheduled', problem: 'It is not a zip archive.' });
    expect(backups[1]).toMatchObject({
      kind: 'manual',
      createdAt: '2026-09-30T10:00:00.000Z',
      appVersion: '0.4.0',
      users: 1,
      notes: 3,
      includesAttachments: false,
      secretMatches: true,
      problem: null,
    });
  });

  it('flags a backup from a newer Catch, or from under another secret', async () => {
    const newer = 'catch-backup-2026-09-30_10-00-00-manual.zip';
    await archive(join(config.backupsDir, newer), { latestMigration: Number.MAX_SAFE_INTEGER });
    expect((await describeBackup(config, newer)).problem).toMatch(/newer version of Catch/);

    const moved = 'catch-backup-2026-09-30_10-00-00-manual-1.zip';
    await archive(join(config.backupsDir, moved), { secret: 'the old secret' });
    expect(await describeBackup(config, moved)).toMatchObject({
      secretMatches: false,
      problem: null,
    });
  });

  it('prunes one kind at a time, oldest first', async () => {
    for (const name of [
      'catch-backup-2026-09-28_03-00-00-scheduled.zip',
      'catch-backup-2026-09-29_03-00-00-scheduled.zip',
      'catch-backup-2026-09-30_03-00-00-scheduled.zip',
      'catch-backup-2026-09-01_12-00-00-manual.zip',
      'catch-backup-2026-09-02_12-00-00-update.zip',
    ]) {
      await writeFile(join(config.backupsDir, name), 'x');
    }
    expect(await pruneBackups(config.backupsDir, 'scheduled', 2)).toEqual([
      'catch-backup-2026-09-28_03-00-00-scheduled.zip',
    ]);
    expect(await names()).toEqual([
      'catch-backup-2026-09-01_12-00-00-manual.zip',
      'catch-backup-2026-09-02_12-00-00-update.zip',
      'catch-backup-2026-09-29_03-00-00-scheduled.zip',
      'catch-backup-2026-09-30_03-00-00-scheduled.zip',
    ]);
  });

  it('never names a new backup after an existing one', async () => {
    const at = new Date('2026-10-01T03:00:00Z');
    const first = await freeBackupName(config.backupsDir, 'manual', at);
    await writeFile(join(config.backupsDir, first), 'x');
    expect(await freeBackupName(config.backupsDir, 'manual', at)).toBe(
      'catch-backup-2026-10-01_03-00-00-manual-1.zip',
    );
    await deleteBackup(config.backupsDir, first);
    await expect(deleteBackup(config.backupsDir, first)).rejects.toThrow(
      'There is no such backup.',
    );
  });

  it('takes in a verified archive as an upload, and refuses anything else', async () => {
    const work = await workDir(config.backupsDir);
    await archive(join(work, 'upload.zip'));
    const name = await importBackup(config, join(work, 'upload.zip'));
    expect(name).toBe('catch-backup-2026-09-30_10-00-00-upload.zip');
    expect(await describeBackup(config, name)).toMatchObject({ kind: 'upload', notes: 3 });

    await writeFile(join(work, 'junk.zip'), 'junk');
    await expect(importBackup(config, join(work, 'junk.zip'))).rejects.toThrow(
      'It is not a zip archive.',
    );
    expect(await listBackups(config)).toHaveLength(1);
  });

  it('clears what an interrupted operation left, once it is old', async () => {
    const fresh = await workDir(config.backupsDir);
    const stale = await workDir(config.backupsDir);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await utimes(stale, yesterday, yesterday);
    await clearStaleWork(config.backupsDir);
    expect(await readdir(join(config.backupsDir, '.tmp'))).toEqual([fresh.split('/').at(-1)]);
  });

  it('keeps the schedule in the directory, off until set', async () => {
    expect(await readSchedule(config.backupsDir)).toEqual({
      schedule: DEFAULT_BACKUP_SCHEDULE,
      lastRunDate: null,
    });
    const state = {
      schedule: { ...DEFAULT_BACKUP_SCHEDULE, enabled: true, time: '04:30', keep: 14 },
      lastRunDate: '2026-10-01',
    };
    await writeSchedule(config.backupsDir, state);
    expect(await readSchedule(config.backupsDir)).toEqual(state);
    expect(await listBackups(config)).toEqual([]);
  });
});
