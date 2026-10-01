import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { backUpBeforeUpdate } from '../backups/beforeUpdate';
import { backupConfig } from '../backups/config';
import { BackupError } from '../backups/errors';
import { env } from '../env';
import { db, sql } from './client';
import { migrationsFolder } from './migrations';

if (env.UPDATE_BACKUPS) {
  try {
    const name = await backUpBeforeUpdate(backupConfig, env.UPDATE_BACKUPS_KEPT);
    if (name) console.log(`Backed up the database before updating: ${name}`);
  } catch (error) {
    // A migration cannot be undone, so it does not run without the backup that could.
    console.error(
      'Could not back up the database before updating. Fix this, or set UPDATE_BACKUPS=false ' +
        'to update without a backup.',
    );
    console.error(error instanceof BackupError ? error.message : error);
    await sql.end();
    process.exit(1);
  }
}

await migrate(db, { migrationsFolder });
await sql.end();
console.log('Migrations applied');
