import { randomBytes } from 'node:crypto';
import { DEFAULT_BOARD_STATUS } from '@catch/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../context';
import type { Db } from '../db/client';
import { migrationsFolder } from '../db/migrations';
import * as schema from '../db/schema';
import { attachmentRoutes } from '../routes/attachments';
import { boardColumnRoutes } from '../routes/boardColumns';
import { shareLinkRoutes } from '../routes/sharing';
import { tagRoutes } from '../routes/tags';
import { lockSharedNote, refreshSharedNote } from './sharing';

const fixture = vi.hoisted(() => ({ db: null as Db | null }));
vi.mock('../db/client', async (original) => {
  const module = await original<typeof import('../db/client')>();
  return {
    ...module,
    get db() {
      return fixture.db ?? module.db;
    },
  };
});

const serverUrl = process.env.BACKUP_TEST_DATABASE_URL ?? '';
const NOTE = '0199a0a0-0000-7000-8000-00000000000a';
const FILE = '0199a0a0-0000-7000-8000-00000000000b';
const TOKEN = 'a'.repeat(43);
const paragraph = (text: string) => [{ type: 'paragraph', content: text }];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

describe.skipIf(!serverUrl)('shared note transaction ordering', () => {
  const name = `catch_sharing_${randomBytes(6).toString('hex')}`;
  let admin: postgres.Sql;
  let connection: postgres.Sql;
  let database: Db;
  let app: Hono<AppEnv>;

  beforeAll(async () => {
    admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const url = new URL(serverUrl);
    url.pathname = `/${name}`;
    connection = postgres(url.toString(), { max: 5, onnotice: () => {} });
    database = drizzle(connection, { schema, casing: 'snake_case' });
    fixture.db = database;
    await migrate(database, { migrationsFolder });
    await database.insert(schema.user).values([
      { id: 'owner', name: 'Owner', email: 'owner@example.com' },
      { id: 'reader', name: 'Reader', email: 'reader@example.com' },
    ]);
    const users = await database.select().from(schema.user);
    app = new Hono<AppEnv>()
      .use(async (c, next) => {
        c.set('user', users.find((user) => user.id === (c.req.header('Test-User') ?? 'reader'))!);
        await next();
      })
      .route('/shares', shareLinkRoutes)
      .route('/attachments', attachmentRoutes)
      .route('/columns', boardColumnRoutes)
      .route('/tags', tagRoutes);
  }, 30_000);

  afterAll(async () => {
    fixture.db = null;
    await connection?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await database.delete(schema.attachments);
    await database.delete(schema.notes);
    await database.delete(schema.tags);
    await database.delete(schema.boardColumns);
    await database.insert(schema.notes).values({
      id: NOTE,
      userId: 'owner',
      content: paragraph('Old text'),
      searchText: 'Old text',
      position: 'a0',
    });
    await database
      .insert(schema.noteShares)
      .values({ noteId: NOTE, userId: 'owner', token: TOKEN });
    await database.insert(schema.attachments).values({
      id: FILE,
      userId: 'owner',
      noteId: NOTE,
      name: 'old.txt',
      mimeType: 'text/plain',
      size: 1,
      kind: 'file',
      status: 'ready',
    });
  });

  const accept = () => app.request(`/shares/${TOKEN}/accept`, { method: 'POST' });
  const copy = async () => (await database.select().from(schema.sharedNotes))[0];

  async function holdNote(change?: (tx: Tx) => Promise<void>, noteId = NOTE) {
    let entered!: (tx: Tx) => void;
    let failed!: (error: unknown) => void;
    let release!: () => void;
    const ready = new Promise<Tx>((resolve, reject) => {
      entered = resolve;
      failed = reject;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const transaction = database.transaction(async (tx) => {
      await lockSharedNote(tx, noteId, 'owner');
      await change?.(tx);
      entered(tx);
      await released;
    });
    // Propagate a setup failure instead of leaving the test waiting for a lock.
    void transaction.catch(failed);
    return {
      tx: await ready,
      finish: async () => {
        release();
        await transaction;
      },
    };
  }

  async function waitingForNote() {
    await vi.waitFor(
      async () => {
        const [row] = await connection`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = ${name} AND wait_event_type = 'Lock'
          AND lower(query) LIKE '%notes%for update%'`;
        expect(row?.waiting).toBeGreaterThan(0);
      },
      { timeout: 5000, interval: 20 },
    );
  }

  it('rejects an old token replaced while acceptance waits for the note', async () => {
    const held = await holdNote();
    const pending = accept();
    try {
      await waitingForNote();
      await held.tx.delete(schema.noteShares);
      await held.tx
        .insert(schema.noteShares)
        .values({ noteId: NOTE, userId: 'owner', token: 'b'.repeat(43) });
    } finally {
      await held.finish();
    }
    expect((await pending).status).toBe(404);
    expect(await copy()).toBeUndefined();
  });

  it('takes the first reader snapshot after an in-flight owner edit commits', async () => {
    const held = await holdNote(async (tx) => {
      await tx
        .update(schema.notes)
        .set({ content: paragraph('New text') })
        .where(eq(schema.notes.id, NOTE));
      await refreshSharedNote(tx, NOTE, 'owner');
    });
    const pending = accept();
    try {
      await waitingForNote();
    } finally {
      await held.finish();
    }
    expect((await pending).status).toBe(200);
    expect((await copy())?.content).toEqual(paragraph('New text'));
  });

  it('serializes column deletion with a tag edit across shared and unshared notes', async () => {
    const second = '0199a0a0-0000-7000-8000-00000000000c';
    const unshared = '0199a0a0-0000-7000-8000-00000000000d';
    const tag = '0199a0a0-0000-7000-8000-00000000000f';
    await database
      .insert(schema.boardColumns)
      .values({ userId: 'owner', id: 'trip', name: 'Trip', color: 'blue', position: 'a0' });
    await database.update(schema.notes).set({ status: 'trip' });
    await database
      .insert(schema.notes)
      .values(
        [second, unshared].map((id) => ({ id, userId: 'owner', status: 'trip', position: 'a1' })),
      );
    await database
      .insert(schema.noteShares)
      .values({ noteId: second, userId: 'owner', token: 'b'.repeat(43) });
    await database.insert(schema.tags).values({ id: tag, userId: 'owner', name: 'Trips' });

    // The tag transaction holds the first linked note and waits for the second. Column
    // deletion must wait at the account lock before locking any of its three note rows.
    const held = await holdNote(undefined, second);
    const edit = app.request(`/tags/${tag}`, {
      method: 'PATCH',
      headers: { 'Test-User': 'owner', 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Travel' }),
    });
    let deletion: Promise<Response> | undefined;
    try {
      await waitingForNote();
      deletion = Promise.resolve(
        app.request('/columns/trip', {
          method: 'DELETE',
          headers: { 'Test-User': 'owner' },
        }),
      );
      await vi.waitFor(
        async () => {
          const [row] = await connection`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = ${name} AND wait_event_type = 'Lock' AND wait_event = 'advisory'`;
          expect(row?.waiting).toBeGreaterThan(0);
        },
        { timeout: 5000, interval: 20 },
      );
    } finally {
      await held.finish();
    }
    expect((await edit).status).toBe(200);
    expect((await deletion)?.status).toBe(200);
    expect((await database.select().from(schema.notes)).map((note) => note.status)).toEqual([
      DEFAULT_BOARD_STATUS,
      DEFAULT_BOARD_STATUS,
      DEFAULT_BOARD_STATUS,
    ]);
    expect((await database.select().from(schema.tags))[0]?.name).toBe('Travel');
    expect(await database.select().from(schema.boardColumns)).toEqual([]);
  }, 15_000);

  it.each([false, true])(
    'an attachment rename cannot overwrite a concurrent owner edit (trashed: %s)',
    async (trashed) => {
      expect((await accept()).status).toBe(200);
      const held = await holdNote(async (tx) => {
        await tx
          .update(schema.notes)
          .set(trashed ? { deletedAt: new Date() } : { content: paragraph('New text') })
          .where(eq(schema.notes.id, NOTE));
        await refreshSharedNote(tx, NOTE, 'owner');
      });
      const pending = app.request(`/attachments/${FILE}`, {
        method: 'PATCH',
        headers: { 'Test-User': 'owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new.txt' }),
      });
      try {
        await waitingForNote();
      } finally {
        await held.finish();
      }
      expect((await pending).status).toBe(200);
      const row = await copy();
      expect(row?.content).toEqual(trashed ? [] : paragraph('New text'));
      expect(row?.isAvailable).toBe(!trashed);
      expect(row?.attachments).toEqual(
        trashed ? [] : [expect.objectContaining({ name: 'new.txt' })],
      );
    },
  );
});
