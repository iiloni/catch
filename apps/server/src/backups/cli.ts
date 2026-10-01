import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { type BackupItem, backupKindSchema } from '@catch/shared';
import { env } from '../env';
import { verifyArchive } from './archive';
import { backupConfig as config } from './config';
import { BackupError } from './errors';
import { createBackup, restoreBackup } from './operations';
import {
  backupPath,
  describeBackup,
  destinationStatus,
  importBackup,
  listBackups,
  pruneBackups,
  workDir,
} from './store';

/**
 * Backups from the command line, for the host scripts (`scripts/backup.sh`, `update.sh`) and
 * for restoring a server that is not running. It works on the same directory as the admin
 * page, so what one makes the other lists.
 */
const USAGE = `Usage: backup <command>

  create [--kind manual|update] [--no-attachments] [--keep N]
                          Back up the database and attachments. --keep prunes older
                          backups of the same kind; update backups keep UPDATE_BACKUPS_KEPT.
  list                    List the backups on this server.
  inspect <backup>        Check every file in a backup against its checksum.
  restore <backup> --yes  Replace this server's data with a backup. Stop the server first.
  export <backup>         Write a backup to standard output.
  import [file]           Add a backup from a file, or from standard input.
  prune --kind K --keep N Remove all but the newest N backups of one kind.

<backup> is a name from 'list', or the path of an archive.`;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function describe(item: BackupItem) {
  const contents = item.includesAttachments ? `${item.attachments} attachments` : 'database only';
  const problem = item.problem ? `  [${item.problem}]` : '';
  return `${item.name}  ${megabytes(item.size)}  ${item.notes} notes, ${item.users} users, ${contents}${problem}`;
}

/** A backup by name in the backups directory, or an archive anywhere by path. */
const archivePath = (backup: string) =>
  backup.includes('/') || isAbsolute(backup) ? backup : backupPath(config.backupsDir, backup);

function required(value: string | undefined, what: string) {
  if (!value) throw new BackupError(`Missing ${what}.\n\n${USAGE}`);
  return value;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      kind: { type: 'string' },
      keep: { type: 'string' },
      'no-attachments': { type: 'boolean', default: false },
      'allow-ephemeral': { type: 'boolean', default: false },
      yes: { type: 'boolean', short: 'y', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, target] = positionals;
  const keep = values.keep === undefined ? undefined : Number(values.keep);
  if (keep !== undefined && (!Number.isInteger(keep) || keep < 1)) {
    throw new BackupError('--keep takes a whole number of backups, at least 1.');
  }

  switch (values.help ? 'help' : command) {
    case 'create': {
      const kind = backupKindSchema
        .extract(['manual', 'update'])
        .safeParse(values.kind ?? 'manual');
      if (!kind.success) throw new BackupError('--kind is manual or update.');
      const destination = await destinationStatus(config);
      if (!destination.persistent && !values['allow-ephemeral']) {
        throw new BackupError(
          `${config.backupsDir} is inside the container, so a backup there is deleted with it. ` +
            'Mount a volume at that path (see docs/backups.md).',
        );
      }
      const name = await createBackup(config, {
        kind: kind.data,
        includeAttachments: !values['no-attachments'],
      });
      // Backups made before an update share the server's own limit unless told otherwise.
      const kept = keep ?? (kind.data === 'update' ? env.UPDATE_BACKUPS_KEPT : undefined);
      if (kept) await pruneBackups(config.backupsDir, kind.data, kept);
      console.log(describe(await describeBackup(config, name)));
      return;
    }
    case 'list': {
      const backups = await listBackups(config);
      console.log(backups.length > 0 ? backups.map(describe).join('\n') : 'No backups yet.');
      return;
    }
    case 'inspect': {
      const { manifest } = await verifyArchive(archivePath(required(target, 'a backup')));
      const { files, ...summary } = manifest;
      console.log(JSON.stringify({ ...summary, files: Object.keys(files).length }, null, 2));
      console.log('Every file matches its checksum.');
      return;
    }
    case 'restore': {
      const path = archivePath(required(target, 'a backup'));
      if (!values.yes) {
        throw new BackupError(
          'Restoring replaces every note, account and session on this server. Pass --yes to go ahead.',
        );
      }
      const outcome = await restoreBackup(config, path);
      console.log(`Restored the backup made at ${outcome.manifest.createdAt}.`);
      if (outcome.safetyBackup) {
        console.log(`The database as it was is in ${outcome.safetyBackup}.`);
      }
      if (outcome.missingAttachments > 0) {
        console.log(
          `${outcome.missingAttachments} attachments in this backup have no file on this server.`,
        );
      }
      return;
    }
    case 'export': {
      const path = backupPath(config.backupsDir, required(target, 'a backup'));
      await pipeline(createReadStream(path), process.stdout);
      return;
    }
    case 'import': {
      const work = await workDir(config.backupsDir);
      try {
        const file = join(work, 'import.zip');
        const source = target && target !== '-' ? createReadStream(target) : process.stdin;
        await pipeline(source, createWriteStream(file, { mode: 0o600 }));
        console.log(describe(await describeBackup(config, await importBackup(config, file))));
      } finally {
        await rm(work, { recursive: true, force: true });
      }
      return;
    }
    case 'prune': {
      const kind = backupKindSchema.safeParse(values.kind);
      if (!kind.success || !keep) throw new BackupError('prune takes --kind and --keep.');
      const removed = await pruneBackups(config.backupsDir, kind.data, keep);
      console.log(removed.length > 0 ? `Removed ${removed.join(', ')}` : 'Nothing to remove.');
      return;
    }
    case 'help':
      console.log(USAGE);
      return;
    default:
      throw new BackupError(USAGE);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof BackupError ? error.message : error);
  process.exitCode = 1;
});
