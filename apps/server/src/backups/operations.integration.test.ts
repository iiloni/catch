import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrationsFolder } from '../db/migrations';
import { backUpBeforeUpdate } from './beforeUpdate';
import { createBackup, restoreBackup } from './operations';
import { type BackupConfig, listBackups } from './store';

/**
 * Backs up and restores real databases with the real pg_dump, pg_restore and psql. It needs
 * a Postgres server to make databases on, which `./scripts/dev.sh check` has.
 */
const serverUrl = process.env.BACKUP_TEST_DATABASE_URL ?? '';
const available = serverUrl !== '' && spawnSync('pg_dump', ['--version']).status === 0;

const NOTE = '0199a0a0-0000-7000-8000-00000000000a';
const FILE = '0199a0a0-0000-7000-8000-00000000000b';
const connect = (url: string) => postgres(url, { max: 1, onnotice: () => {} });

describe.skipIf(!available)('backing up and restoring a database', () => {
  const suffix = randomBytes(6).toString('hex');
  const databases = [`catch_test_${suffix}`, `catch_test_${suffix}_new`];
  const urlOf = (name: string) => {
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    return url.toString();
  };
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let dir: string;
  let config: BackupConfig;

  const notes = async () =>
    (await sql`SELECT search_text FROM notes ORDER BY 1`).map((row) => row.search_text);
  const users = async () => (await sql`SELECT id FROM "user" ORDER BY 1`).map((row) => row.id);

  beforeAll(async () => {
    admin = connect(serverUrl);
    for (const name of databases) await admin.unsafe(`CREATE DATABASE "${name}"`);
    dir = await mkdtemp(join(tmpdir(), 'catch-restore-'));
    config = {
      databaseUrl: urlOf(databases[0]!),
      attachmentsDir: join(dir, 'attachments'),
      backupsDir: join(dir, 'backups'),
      migrationsFolder,
      secret: 'a-secret',
      appVersion: '0.5.0',
    };
    await mkdir(config.attachmentsDir);
    await mkdir(config.backupsDir);

    sql = connect(config.databaseUrl);
    await migrate(drizzle(sql), { migrationsFolder });
    await sql`INSERT INTO "user" (id, name, email) VALUES ('ada', 'Ada', 'ada@example.com')`;
    await sql`
      INSERT INTO notes (id, user_id, content, search_text, position)
      VALUES (${NOTE}, 'ada', ${JSON.stringify([{ type: 'paragraph' }])}::jsonb, 'kept', 'a0')`;
    await sql`
      INSERT INTO attachments (id, user_id, note_id, name, mime_type, size, kind, status)
      VALUES (${FILE}, 'ada', ${NOTE}, 'photo.png', 'image/png', 5, 'image', 'ready')`;
    await writeFile(join(config.attachmentsDir, FILE), 'photo');
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    for (const name of databases) {
      await admin?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    }
    await admin?.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  /** What changes after a backup: a note goes, a user arrives, a file is lost. */
  async function change() {
    await sql`DELETE FROM notes`;
    await sql`INSERT INTO "user" (id, name, email) VALUES ('eve', 'Eve', 'eve@example.com')`;
    await rm(join(config.attachmentsDir, FILE), { force: true });
  }

  it('puts back every row and file, and keeps the database it replaced', async () => {
    const name = await createBackup(config, { kind: 'manual', includeAttachments: true });
    const [backup] = await listBackups(config);
    expect(backup).toMatchObject({
      name,
      kind: 'manual',
      appVersion: '0.5.0',
      users: 1,
      notes: 1,
      attachments: 1,
      includesAttachments: true,
      problem: null,
    });

    await change();
    const outcome = await restoreBackup(config, join(config.backupsDir, name));
    expect(await notes()).toEqual(['kept']);
    expect(await users()).toEqual(['ada']);
    expect(await readFile(join(config.attachmentsDir, FILE), 'utf8')).toBe('photo');
    expect(outcome.missingAttachments).toBe(0);

    // The state the restore replaced can itself be restored.
    expect(outcome.safetyBackup).toMatch(/-pre-restore\.zip$/);
    await restoreBackup(config, join(config.backupsDir, outcome.safetyBackup!));
    expect(await notes()).toEqual([]);
    expect(await users()).toEqual(['ada', 'eve']);
    await restoreBackup(config, join(config.backupsDir, name));
    expect(await notes()).toEqual(['kept']);
  }, 120_000);

  it('says which attachments a database-only backup has no files for', async () => {
    const name = await createBackup(config, { kind: 'update', includeAttachments: false });
    await change();
    const outcome = await restoreBackup(config, join(config.backupsDir, name));
    expect(await notes()).toEqual(['kept']);
    expect(outcome.missingAttachments).toBe(1);
    await writeFile(join(config.attachmentsDir, FILE), 'photo');
  }, 120_000);

  it('restores onto a new server, whose database is empty', async () => {
    const name = await createBackup(config, { kind: 'manual', includeAttachments: true });
    const fresh: BackupConfig = {
      ...config,
      databaseUrl: urlOf(databases[1]!),
      attachmentsDir: join(dir, 'new-attachments'),
    };
    const outcome = await restoreBackup(fresh, join(config.backupsDir, name));
    expect(outcome).toMatchObject({ safetyBackup: null, missingAttachments: 0 });
    expect(await readFile(join(fresh.attachmentsDir, FILE), 'utf8')).toBe('photo');
    const restored = connect(fresh.databaseUrl);
    try {
      expect(await restored`SELECT id FROM notes`).toHaveLength(1);
    } finally {
      await restored.end();
    }
  }, 120_000);

  it('leaves the database alone when the backup is damaged or from a newer Catch', async () => {
    const name = await createBackup(config, { kind: 'manual', includeAttachments: false });
    const path = join(config.backupsDir, name);
    await change();
    const safetyBackups = (await listBackups(config)).filter(
      (backup) => backup.kind === 'pre-restore',
    );

    const older = join(dir, 'older-migrations');
    await mkdir(join(older, 'meta'), { recursive: true });
    await writeFile(
      join(older, 'meta', '_journal.json'),
      JSON.stringify({ entries: [{ when: 1 }] }),
    );
    await expect(restoreBackup({ ...config, migrationsFolder: older }, path)).rejects.toThrow(
      /newer version of Catch/,
    );

    const bytes = await readFile(path);
    bytes.write('XXXX', bytes.indexOf('PGDMP') + 100);
    const damaged = join(dir, 'damaged.zip');
    await writeFile(damaged, bytes);
    await expect(restoreBackup(config, damaged)).rejects.toThrow(/does not match its checksum/);

    // An older Catch started on a database a newer one has migrated: its rows would land in
    // a schema it does not know.
    await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('later', 9999999999999)`;
    await expect(restoreBackup(config, path)).rejects.toThrow(/migrated by a newer version/);
    await sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'later'`;

    expect(await notes()).toEqual([]);
    expect(await users()).toEqual(['ada', 'eve']);
    expect((await listBackups(config)).filter((backup) => backup.kind === 'pre-restore')).toEqual(
      safetyBackups,
    );
  }, 120_000);

  it('backs up before an update, once', async () => {
    const backupsDir = join(dir, 'update-backups');
    await mkdir(backupsDir);
    const updating = { ...config, backupsDir };
    // Up to date, and the first start of this release: nothing to protect.
    expect(await backUpBeforeUpdate(updating, 2)).toBeNull();
    expect(await backUpBeforeUpdate(updating, 2)).toBeNull();

    const next = { ...updating, appVersion: '0.6.0' };
    const name = await backUpBeforeUpdate(next, 2);
    expect(name).toMatch(/-update\.zip$/);
    expect((await stat(join(backupsDir, name!))).size).toBeGreaterThan(0);
    // Started again at once, as after a crash: the backup just made stands.
    expect(await backUpBeforeUpdate({ ...next, appVersion: '0.6.1' }, 2)).toBeNull();

    // A migration this database has not had counts as an update whatever the version says.
    await sql`DELETE FROM drizzle.__drizzle_migrations
      WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations)`;
    const later = Date.now() + 60 * 60 * 1000;
    expect(await backUpBeforeUpdate({ ...next, appVersion: null }, 2, later)).toMatch(
      /-update(-1)?\.zip$/,
    );
  }, 120_000);
});
