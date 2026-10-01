import { migrationsFolder } from '../db/migrations';
import { env } from '../env';
import type { BackupConfig } from './store';

/** This server's own state, for the routes, the scheduler and the CLI. */
export const backupConfig: BackupConfig = {
  databaseUrl: env.DATABASE_URL,
  attachmentsDir: env.ATTACHMENTS_DIR,
  backupsDir: env.BACKUPS_DIR,
  migrationsFolder,
  secret: env.BETTER_AUTH_SECRET,
  appVersion: env.CATCH_VERSION || null,
};
