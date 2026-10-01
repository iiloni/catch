import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { z } from 'zod';
import type { DatabaseInfo } from './archive';
import { BackupError } from './errors';

// Each step opens its own connection instead of the server's pool: the CLI runs these with
// no server, and a restore points one at a scratch database.
const connect = (url: string) => postgres(url, { max: 1, onnotice: () => {} });

/** The connection as libpq's environment, which keeps the password out of process arguments. */
function connectionEnv(url: string): NodeJS.ProcessEnv {
  const parsed = new URL(url);
  const sslmode = parsed.searchParams.get('sslmode');
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)),
    ...(sslmode ? { PGSSLMODE: sslmode } : {}),
  };
}

function withDatabase(url: string, name: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function run(command: string, args: string[], url: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: connectionEnv(url),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(
        new BackupError(
          error.code === 'ENOENT'
            ? `${command} is not installed. Backups need the PostgreSQL client tools.`
            : `${command} could not run: ${error.message}`,
        ),
      ),
    );
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new BackupError(`${command} failed: ${stderr.trim() || `exit code ${code}`}`)),
    );
  });
}

/** Whether the database has been migrated at all. A new server's has not. */
export async function hasCatchData(url: string) {
  const sql = connect(url);
  try {
    const [row] = await sql<{ found: boolean }[]>`
      SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS found`;
    return row?.found === true;
  } finally {
    await sql.end();
  }
}

/** What a backup's manifest says about the database, read when the backup starts. */
export async function databaseInfo(url: string): Promise<DatabaseInfo> {
  if (!(await hasCatchData(url))) throw new BackupError('This server has no data to back up yet.');
  const sql = connect(url);
  try {
    const [version] = await sql<{ version: string }[]>`
      SELECT current_setting('server_version') AS version`;
    const [migrations] = await sql<{ count: number; latest: string | null }[]>`
      SELECT count(*)::int AS count, max(created_at)::text AS latest
      FROM drizzle.__drizzle_migrations`;
    // Counted for the admin's benefit only, and before this build's migrations have run: a
    // table an older version did not have counts as empty rather than failing the backup.
    const count = async (table: string, where = sql`TRUE`) => {
      const [found] = await sql<{ found: boolean }[]>`
        SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS found`;
      if (!found?.found) return 0;
      const [row] = await sql<{ total: number }[]>`
        SELECT count(*)::int AS total FROM ${sql(table)} WHERE ${where}`;
      return row?.total ?? 0;
    };
    return {
      postgres: version?.version ?? 'unknown',
      migrations: migrations?.count ?? 0,
      latestMigration: migrations?.latest ? Number(migrations.latest) : null,
      users: await count('user'),
      notes: await count('notes'),
      attachments: await count('attachments', sql`status = 'ready' AND deleted_at IS NULL`),
    };
  } finally {
    await sql.end();
  }
}

const journalSchema = z.object({ entries: z.array(z.object({ when: z.number().int() })) });

/** When this build's newest migration was generated. A backup past it came from a newer Catch. */
export async function latestKnownMigration(migrationsFolder: string) {
  const journal = journalSchema.parse(
    JSON.parse(await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')),
  );
  return Math.max(0, ...journal.entries.map((entry) => entry.when));
}

/** Dumps the whole database in pg_dump's custom format, which is compressed. */
export async function dumpDatabase(url: string, file: string) {
  await run(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      // Electric's publication belongs to the running server, not to the data.
      '--no-publications',
      '--no-subscriptions',
      '--file',
      file,
    ],
    url,
  );
  // Reading the dump's table of contents catches one that pg_dump left unfinished.
  await run('pg_restore', ['--list', '--file', '/dev/null', file], url);
  if ((await stat(file)).size === 0) throw new BackupError('pg_dump wrote an empty dump.');
}

async function publicTables(sql: postgres.Sql) {
  const rows = await sql<{ name: string }[]>`
    SELECT format('%I.%I', schemaname, tablename) AS name
    FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`;
  return rows.map((row) => row.name);
}

/**
 * Replaces the database's rows with a dump's, in three steps:
 *
 * 1. Load the dump into a scratch database and migrate it to this build's schema. A damaged
 *    dump or a failing migration stops here, with the live database untouched.
 * 2. Copy the scratch database's rows out.
 * 3. In one transaction, truncate the live tables and load those rows.
 *
 * The live tables are emptied and refilled rather than dropped and recreated because Electric
 * follows tables by identity. A truncate reaches it through replication and invalidates
 * every shape, so each device re-syncs; a dropped table would leave it serving stale logs.
 */
export async function restoreDatabase(
  url: string,
  dumpFile: string,
  { workDir, migrationsFolder }: { workDir: string; migrationsFolder: string },
) {
  const live = connect(url);
  const scratchName = `catch_restore_${randomBytes(6).toString('hex')}`;
  const scratchUrl = withDatabase(url, scratchName);
  try {
    // The server's database is migrated already. A new server's (the CLI on a fresh host)
    // has no tables to restore into yet.
    await migrate(drizzle(live), { migrationsFolder });
    try {
      await live.unsafe(`CREATE DATABASE "${scratchName}"`);
    } catch (error) {
      throw new BackupError(
        `Restoring needs a scratch database, which the database user could not create: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    await run(
      'pg_restore',
      ['--no-owner', '--no-privileges', '--exit-on-error', '--dbname', scratchName, dumpFile],
      url,
    );

    const scratch = connect(scratchUrl);
    let tables: string[];
    try {
      await migrate(drizzle(scratch), { migrationsFolder });
      tables = await publicTables(live);
      const restored = await publicTables(scratch);
      if (tables.join() !== restored.join()) {
        throw new BackupError('The backup’s tables do not match this version of Catch.');
      }
    } finally {
      await scratch.end();
    }

    const dataFile = join(workDir, 'data.sql');
    await run(
      'pg_dump',
      ['--data-only', '--schema=public', '--no-owner', '--no-privileges', '--file', dataFile],
      scratchUrl,
    );
    const clearFile = join(workDir, 'clear.sql');
    await writeFile(
      clearFile,
      tables.length > 0 ? `TRUNCATE TABLE ${tables.join(', ')} CASCADE;\n` : '',
    );
    await run(
      'psql',
      [
        '--no-psqlrc',
        '--quiet',
        '--single-transaction',
        '--set',
        'ON_ERROR_STOP=1',
        '--file',
        clearFile,
        '--file',
        dataFile,
      ],
      url,
    );
  } finally {
    await live
      .unsafe(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`)
      .catch((error: unknown) => console.error(`Could not drop ${scratchName}`, error));
    await live.end();
  }
}

/** The attachments the database lists as uploaded, to tell which have no file on disk. */
export async function listedAttachments(url: string) {
  const sql = connect(url);
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM attachments WHERE status = 'ready' AND deleted_at IS NULL`;
    return rows.map((row) => row.id);
  } finally {
    await sql.end();
  }
}
