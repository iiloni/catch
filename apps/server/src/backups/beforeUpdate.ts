import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseBackupFileName } from '@catch/shared';
import { createBackup } from './operations';
import { databaseInfo, hasCatchData, latestKnownMigration } from './postgres';
import { type BackupConfig, destinationStatus, listBackups, pruneBackups } from './store';

const LAST_VERSION = '.last-version';
// `scripts/update.sh` backs up just before it replaces the server, and a server that cannot
// start is restarted over and over. Neither should add a second backup of the same data.
const FRESH_MS = 15 * 60 * 1000;

/**
 * Backs up the database before a new version first touches it: when migrations are waiting,
 * or when this release is not the one that ran last. It runs at startup, ahead of the
 * migrations, so it covers every way of updating (`docker compose pull`, an auto-updater,
 * `scripts/update.sh`) without anyone remembering to. Attachments are left out: an update
 * changes the database, and they would be copied again for every release. Returns the
 * backup's name, or null when there was nothing to protect.
 */
export async function backUpBeforeUpdate(config: BackupConfig, keep: number, now = Date.now()) {
  const versionFile = join(config.backupsDir, LAST_VERSION);
  const previous = await readFile(versionFile, 'utf8').then(
    (value) => value.trim(),
    () => null,
  );
  const remember = async () => {
    if (config.appVersion && config.appVersion !== previous) {
      await writeFile(versionFile, `${config.appVersion}\n`).catch(() => {});
    }
  };

  // A new server has nothing to lose yet.
  if (!(await hasCatchData(config.databaseUrl))) return remember().then(() => null);
  const { latestMigration } = await databaseInfo(config.databaseUrl);
  const pending = (latestMigration ?? 0) < (await latestKnownMigration(config.migrationsFolder));
  const newVersion = Boolean(config.appVersion && previous && previous !== config.appVersion);
  if (!pending && !newVersion) return remember().then(() => null);

  const recent = (await listBackups(config)).find((backup) => backup.kind === 'update');
  const madeAt = recent && parseBackupFileName(recent.name)?.createdAt.getTime();
  if (madeAt && now - madeAt < FRESH_MS) return remember().then(() => null);

  if (!(await destinationStatus(config)).persistent) {
    console.warn(
      `${config.backupsDir} is inside the container: this backup is deleted when the container ` +
        'is replaced. Mount a volume there (see docs/backups.md).',
    );
  }
  const name = await createBackup(config, { kind: 'update', includeAttachments: false });
  await pruneBackups(config.backupsDir, 'update', keep);
  await remember();
  return name;
}
