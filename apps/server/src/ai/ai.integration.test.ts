import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_EMBEDDING_CONFIGURATION,
  hybridSearchSchema,
  saveAiConfigurationSchema,
} from '@catch/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEmbeddingProvider } from '../../../../e2e/fixtures/embeddingProvider';
import { createBackup } from '../backups/operations';
import { backupOverview, runRestore } from '../backups/service';
import type { BackupConfig } from '../backups/store';
import type { AppEnv } from '../context';
import type { Db } from '../db/client';
import { migrationsFolder } from '../db/migrations';
import * as schema from '../db/schema';
import { aiRoutes } from '../routes/ai';
import {
  AiAccessDenied,
  ConfigurationConflict,
  enqueueMissing,
  overview,
  resolveProvider,
  restartIndex,
  saveConfiguration,
} from './configuration';
import { openCredential, sealCredential } from './credentials';
import { hybridSearch, rankNotes } from './search';
import {
  pauseEmbeddingWorker,
  processEmbeddingBatch,
  processEmbeddingJob,
  startEmbeddingWorker,
} from './worker';

const fixture = vi.hoisted(() => ({
  db: null as Db | null,
  backupConfig: null as BackupConfig | null,
}));
vi.mock('../db/client', async (original) => {
  const module = await original<typeof import('../db/client')>();
  return {
    ...module,
    get db() {
      return fixture.db ?? module.db;
    },
  };
});
vi.mock('../backups/config', () => ({
  get backupConfig() {
    return fixture.backupConfig;
  },
}));
const serverUrl = process.env.BACKUP_TEST_DATABASE_URL ?? '';
const NOTE = '0199a0a0-0000-7000-8000-00000000000a';
const OTHER = '0199a0a0-0000-7000-8000-00000000000b';
const ROOT = '0199a0a0-0000-7000-8000-00000000000c';
const CHILD = '0199a0a0-0000-7000-8000-00000000000d';
const SECOND = '0199a0a0-0000-7000-8000-00000000000e';
const TOKEN = 'a'.repeat(43);
const query = (overrides = {}) => hybridSearchSchema.parse({ query: 'cycling', ...overrides });

describe.skipIf(!serverUrl)('AI indexing and authorized hybrid search on Postgres', () => {
  const name = `catch_ai_${randomBytes(6).toString('hex')}`;
  let admin: postgres.Sql;
  let connection: postgres.Sql;
  let database: Db;
  let fake: Awaited<ReturnType<typeof fakeEmbeddingProvider>>;
  let app: Hono<AppEnv>;
  let backupDir: string;
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
      { id: 'owner', name: 'Owner', email: 'owner@example.com', role: 'admin' },
      { id: 'reader', name: 'Reader', email: 'reader@example.com' },
    ]);
    const users = await database.select().from(schema.user);
    app = new Hono<AppEnv>()
      .use(async (c, next) => {
        c.set('user', users[0]!);
        await next();
      })
      .route('/', aiRoutes);
    fake = await fakeEmbeddingProvider();
    backupDir = await mkdtemp(join(tmpdir(), 'catch-ai-restore-'));
    await mkdir(join(backupDir, 'attachments'));
    await mkdir(join(backupDir, 'backups'));
    fixture.backupConfig = {
      databaseUrl: url.toString(),
      attachmentsDir: join(backupDir, 'attachments'),
      backupsDir: join(backupDir, 'backups'),
      migrationsFolder,
      secret: 'test-secret',
      appVersion: null,
    };
  }, 30_000);
  afterAll(async () => {
    await pauseEmbeddingWorker();
    fixture.db = null;
    fixture.backupConfig = null;
    if (backupDir) await rm(backupDir, { recursive: true, force: true });
    await fake?.close();
    await connection?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin?.end();
  });
  beforeEach(async () => {
    fake.state.fail = false;
    fake.state.failureStatus = 400;
    fake.state.dimensions = 3;
    fake.state.beforeReply = null;
    fake.state.maxInputs = Number.POSITIVE_INFINITY;
    fake.state.rejectText = null;
    fake.calls.length = 0;
    await database.delete(schema.notes);
    await database.delete(schema.vaults);
    await database.delete(schema.tags);
    await database.delete(schema.aiConfiguration);
    await database.update(schema.user).set({ role: 'admin' }).where(eq(schema.user.id, 'owner'));
    await database.insert(schema.notes).values([
      { id: NOTE, userId: 'owner', searchText: 'Bicycle ride', position: 'a0' },
      {
        id: OTHER,
        userId: 'reader',
        searchText: 'Groceries milk',
        isArchived: true,
        position: 'a0',
      },
    ]);
  });
  const save = async (overrides = {}) =>
    saveConfiguration(
      saveAiConfigurationSchema.parse({
        enabled: true,
        revision: (await overview()).revision,
        embedding: {
          ...DEFAULT_EMBEDDING_CONFIGURATION,
          provider: 'compatible',
          baseUrl: fake.url,
          model: 'fake-embedding',
          profile: 'plain',
        },
        ...overrides,
      }),
      'owner',
    );
  const jobs = () => database.select().from(schema.embeddingJobs);
  const embeddings = () => database.select().from(schema.noteEmbeddings);
  const run = async () => {
    await connection`UPDATE embedding_jobs SET available_at = now()`;
    await processEmbeddingJob();
  };
  const rank = async (user = 'owner', overrides = {}) => {
    const [config] = await database.select().from(schema.aiConfiguration);
    return (await rankNotes(user, query(overrides), [1, 0, 0], config!.generation)).map(
      (hit) => hit.id,
    );
  };
  async function holdResponse(process = processEmbeddingJob) {
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.state.beforeReply = async () => {
      enter();
      await released;
    };
    const pending = process();
    await entered;
    return {
      finish: async () => {
        release();
        await pending;
        fake.state.beforeReply = null;
      },
    };
  }
  it('backfills every account and archived notes, but never vault rows', async () => {
    await database.insert(schema.vaults).values({
      userId: 'owner',
      salt: 'salt',
      iterations: 1,
      passwordKey: 'sealed',
      recoveryKey: 'sealed',
    });
    await database.insert(schema.vaultNotes).values({ id: ROOT, userId: 'owner', data: 'sealed' });
    await save();
    expect(await jobs()).toHaveLength(2);
    await run();
    await run();
    expect((await overview()).progress).toMatchObject({ total: 2, ready: 2, pending: 0 });
    expect(fake.calls.flatMap((call) => call.input).join(' ')).not.toContain('sealed');
    expect(await rank()).toEqual([NOTE]);
    expect(await rank('reader')).toEqual([OTHER]);
    expect(await rank('reader', { showArchived: false })).toEqual([]);
  });
  it('embeds fifty short notes from multiple users in one request', async () => {
    await database.insert(schema.notes).values(
      Array.from({ length: 48 }, (_, i) => ({
        id: randomUUID(),
        userId: i % 2 ? 'owner' : 'reader',
        searchText: `cycling ${i}`,
        position: 'a0',
        isArchived: i % 2 === 0,
      })),
    );
    await save();
    fake.calls.length = 0;
    expect(await processEmbeddingBatch()).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.input).toHaveLength(50);
    expect((await overview()).progress).toMatchObject({ total: 50, ready: 50, pending: 0 });
    const indexed = await embeddings();
    expect(indexed.filter((row) => row.userId === 'owner')).toHaveLength(25);
    expect(indexed.filter((row) => row.userId === 'reader')).toHaveLength(25);
    expect(await processEmbeddingBatch()).toBe(false);
  });
  it('splits rejected batches and remembers the smaller limit without duplicating inputs', async () => {
    await database.insert(schema.notes).values(
      Array.from({ length: 6 }, (_, i) => ({
        id: randomUUID(),
        userId: 'owner',
        searchText: `cycling ${i}`,
        position: 'a0',
      })),
    );
    await save();
    fake.calls.length = 0;
    fake.state.maxInputs = 2;
    await processEmbeddingBatch();
    const accepted = fake.calls
      .filter((call) => call.input.length <= 2)
      .flatMap((call) => call.input);
    expect(accepted).toHaveLength(8);
    expect(new Set(accepted).size).toBe(8);
    expect((await overview()).progress.ready).toBe(8);
    await database.insert(schema.notes).values(
      Array.from({ length: 4 }, (_, i) => ({
        id: randomUUID(),
        userId: 'owner',
        searchText: `new note ${i}`,
        position: 'a0',
      })),
    );
    fake.calls.length = 0;
    await connection`UPDATE embedding_jobs SET available_at = now()`;
    await processEmbeddingBatch();
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.every((call) => call.input.length <= 2)).toBe(true);
    expect((await overview()).progress.ready).toBe(12);
  });
  it('isolates a rejected note while indexing healthy notes in the same batch', async () => {
    await connection`UPDATE notes SET search_text = 'invalid-text' WHERE id = ${NOTE}`;
    await save();
    fake.state.rejectText = 'invalid-text';
    await processEmbeddingBatch();
    expect((await embeddings()).map((row) => row.noteId)).toEqual([OTHER]);
    expect((await jobs()).map((job) => job.noteId)).toEqual([NOTE]);
    expect((await jobs())[0]!.error).toContain('HTTP 400');
    fake.state.rejectText = null;
    await connection`UPDATE embedding_jobs SET available_at = now()`;
    await processEmbeddingBatch();
    expect((await overview()).progress.ready).toBe(2);
  });
  it.each([429, 500])(
    'backs off a destination-wide HTTP %s without per-input fan-out',
    async (status) => {
      await save();
      fake.calls.length = 0;
      fake.state.fail = true;
      fake.state.failureStatus = status;
      await processEmbeddingBatch();
      expect(fake.calls).toHaveLength(1);
      expect(await embeddings()).toHaveLength(0);
      expect(
        (await jobs()).every((job) => job.lease === null && job.availableAt > new Date()),
      ).toBe(true);
      fake.state.fail = false;
      fake.calls.length = 0;
      await connection`UPDATE embedding_jobs SET available_at = now()`;
      await processEmbeddingBatch();
      expect(fake.calls).toHaveLength(status === 500 ? 2 : 1);
      expect((await overview()).progress.ready).toBe(2);
    },
  );
  it('bounds UTF-8 input bytes while preserving every long-note chunk', async () => {
    await connection`UPDATE notes SET search_text = ${'🚲'.repeat(24000)} WHERE id = ${NOTE}`;
    await save();
    fake.calls.length = 0;
    await processEmbeddingBatch();
    expect(fake.calls.length).toBeGreaterThan(1);
    expect(
      fake.calls.every(
        (call) =>
          call.input.length <= 50 &&
          call.input.reduce((sum, text) => sum + Buffer.byteLength(text), 0) <= 64 * 1024,
      ),
    ).toBe(true);
    expect((await embeddings()).filter((row) => row.noteId === NOTE)).toHaveLength(14);
    expect((await overview()).progress.ready).toBe(2);
  });
  it('claims a batch once and discards only a changed note from its response', async () => {
    await save();
    const held = await holdResponse(() => processEmbeddingBatch());
    try {
      expect(await processEmbeddingBatch()).toBe(false);
      await connection`UPDATE notes SET search_text = 'changed while embedding' WHERE id = ${NOTE}`;
    } finally {
      await held.finish();
    }
    expect((await embeddings()).map((row) => row.noteId)).toEqual([OTHER]);
    await connection`UPDATE embedding_jobs SET available_at = now()`;
    await processEmbeddingBatch();
    expect((await overview()).progress.ready).toBe(2);
  });
  it('does not attach a stale provider failure to jobs after a credential rotation', async () => {
    await save({ apiKey: 'old-key' });
    const held = await holdResponse(() => processEmbeddingBatch());
    try {
      // The old request is already held; let the new credential's connection test complete.
      fake.state.beforeReply = null;
      await save({ apiKey: 'new-key' });
      fake.state.fail = true;
      fake.state.failureStatus = 401;
    } finally {
      await held.finish();
    }
    expect(
      (await jobs()).every(
        (job) => job.error === null && job.failedAt === null && job.lease === null,
      ),
    ).toBe(true);
    fake.state.fail = false;
    await processEmbeddingBatch();
    expect((await overview()).progress.ready).toBe(2);
    expect(fake.calls.at(-1)?.authorization).toBe('Bearer new-key');
  });
  it('invalidates on edit, trash, untrash and delete', async () => {
    await save();
    await run();
    await run();
    await connection`UPDATE notes SET search_text = 'Changed' WHERE id = ${NOTE}`;
    expect((await embeddings()).some((e) => e.noteId === NOTE)).toBe(false);
    await run();
    expect((await embeddings()).find((e) => e.noteId === NOTE)?.embedding).toEqual([0, 0, 1]);
    await connection`UPDATE notes SET deleted_at = now() WHERE id = ${NOTE}`;
    expect(await rank()).toEqual([]);
    expect((await jobs()).some((j) => j.noteId === NOTE)).toBe(false);
    await connection`UPDATE notes SET deleted_at = NULL WHERE id = ${NOTE}`;
    await run();
    expect(await rank()).toEqual([NOTE]);
    await connection`DELETE FROM notes WHERE id = ${NOTE}`;
    expect((await embeddings()).some((e) => e.noteId === NOTE)).toBe(false);
  });
  it('discards a response for changed content, then indexes the replacement job', async () => {
    await save();
    const held = await holdResponse();
    try {
      await connection`UPDATE notes SET search_text = 'Changed' WHERE id = ${NOTE}`;
    } finally {
      await held.finish();
    }
    expect(await embeddings()).toEqual([]);
    await run();
    await run();
    expect((await embeddings()).find((e) => e.noteId === NOTE)?.embedding).toEqual([0, 0, 1]);
  });
  it.each(['disable', 'rebuild'] as const)(
    'stops remaining batches after a mid-job %s',
    async (operation) => {
      await save();
      await connection`UPDATE notes SET search_text = ${'cycling '.repeat(12000)} WHERE id = ${NOTE}`;
      await connection`UPDATE embedding_jobs SET available_at = now() WHERE note_id = ${NOTE}`;
      await connection`UPDATE embedding_jobs SET available_at = now() + interval '1 day' WHERE note_id = ${OTHER}`;
      const held = await holdResponse();
      try {
        const sent = fake.calls.length;
        if (operation === 'disable') await save({ enabled: false });
        else await restartIndex('owner', true, (await overview()).revision);
        await held.finish();
        expect(fake.calls).toHaveLength(sent);
        expect(await embeddings()).toEqual([]);
        expect((await jobs()).every((job) => job.lease === null)).toBe(true);
      } finally {
        await held.finish();
      }
    },
  );
  it('discards a response after a generation rebuild or disable', async () => {
    await save();
    const held = await holdResponse();
    try {
      await restartIndex('owner', true, (await overview()).revision);
    } finally {
      await held.finish();
    }
    expect(await embeddings()).toEqual([]);
    await run();
    const next = await holdResponse();
    try {
      await save({ enabled: false });
    } finally {
      await next.finish();
    }
    expect(await embeddings()).toHaveLength(1);
    const calls = fake.calls.length;
    await processEmbeddingJob();
    expect(fake.calls).toHaveLength(calls);
    await save();
    await run();
    expect((await overview()).progress.ready).toBe(2);
  });
  it('retries failures, expires abandoned leases and isolates stale error handlers', async () => {
    await save();
    fake.state.fail = true;
    await connection`UPDATE embedding_jobs SET available_at = now() + interval '1 day' WHERE note_id = ${OTHER}`;
    for (let n = 0; n < 5; n++) {
      await connection`UPDATE embedding_jobs SET available_at = now() WHERE note_id = ${NOTE}`;
      await processEmbeddingJob();
    }
    expect((await jobs()).find((j) => j.noteId === NOTE)?.failedAt).not.toBeNull();
    fake.state.fail = false;
    await restartIndex('owner', false);
    await connection`UPDATE embedding_jobs SET lease = gen_random_uuid(), leased_until = now() - interval '1 second' WHERE note_id = ${NOTE}`;
    await run();
    await run();
    expect((await overview()).progress.ready).toBe(2);
  });
  it('rejects model dimension drift without saving invalid vectors', async () => {
    await save();
    fake.state.dimensions = 4;
    await run();
    expect(await embeddings()).toEqual([]);
    expect((await jobs()).some((j) => j.error?.includes('dimensions changed'))).toBe(true);
    await save();
    await run();
    await run();
    expect((await overview()).dimensions).toBe(4);
  });
  it('infers formats, preserves generations on key rotation, and refuses stale revisions', async () => {
    const first = await save({ apiKey: 'key-one' });
    await run();
    await run();
    const [old] = await database.select().from(schema.aiConfiguration);
    await save({ apiKey: 'key-two' });
    const [current] = await database.select().from(schema.aiConfiguration);
    expect(current!.generation).toBe(old!.generation);
    expect(await embeddings()).toHaveLength(2);
    await expect(save({ revision: first.revision })).rejects.toBeInstanceOf(ConfigurationConflict);
    await expect(restartIndex('owner', true, first.revision)).rejects.toBeInstanceOf(
      ConfigurationConflict,
    );
    await save({ embedding: { ...current!.embedding, profile: 'e5' }, apiKey: 'key-two' });
    expect((await overview()).embedding.profile).toBe('plain');
    expect(await embeddings()).toHaveLength(2);
    await save({
      embedding: { ...current!.embedding, model: 'nomic-embed-text', profile: 'plain' },
    });
    expect((await overview()).embedding.profile).toBe('nomic');
    expect(await embeddings()).toEqual([]);
    expect(fake.calls.at(-1)?.input[0]).toBe('search_query: Catch embedding connection test');
    await run();
    await run();
    expect(
      fake.calls
        .slice(-2)
        .flatMap((call) => call.input)
        .every((text) => text.startsWith('search_document: ')),
    ).toBe(true);
    const config = await overview();
    expect(
      (
        await resolveProvider({
          embedding: { ...config.embedding, model: 'BAAI/bge-m3', profile: 'nomic' },
        })
      ).profile,
    ).toBe('plain');
  });
  it('reconciles notes inserted while enablement was off', async () => {
    await save({ enabled: false });
    expect(await jobs()).toEqual([]);
    await save();
    await database.delete(schema.embeddingJobs);
    await enqueueMissing(database);
    expect(await jobs()).toHaveLength(2);
  });
  it('preserves a legacy E5 index until saving its new automatic instruction format', async () => {
    const initial = await save({
      embedding: {
        ...DEFAULT_EMBEDDING_CONFIGURATION,
        provider: 'compatible',
        baseUrl: fake.url,
        model: 'e5-mistral-7b-instruct',
        profile: 'e5',
      },
    });
    const { profileVersion: _version, ...legacy } = initial.embedding;
    await database.update(schema.aiConfiguration).set({ embedding: legacy });
    await run();
    await run();
    expect(fake.calls.at(-1)?.input[0]).toMatch(/^passage: /);
    const [before] = await database.select().from(schema.aiConfiguration);
    expect(await embeddings()).toHaveLength(2);
    const updated = await save({ embedding: legacy });
    expect(updated.embedding.profileVersion).toBe(2);
    expect(await embeddings()).toHaveLength(0);
    const [after] = await database.select().from(schema.aiConfiguration);
    expect(after!.generation).not.toBe(before!.generation);
    await run();
    await run();
    expect(
      fake.calls
        .slice(-2)
        .flatMap((call) => call.input)
        .every((text) => !text.startsWith('passage: ')),
    ).toBe(true);
    await save({ embedding: updated.embedding, apiKey: 'rotated-key' });
    expect((await database.select().from(schema.aiConfiguration))[0]!.generation).toBe(
      after!.generation,
    );
    expect(await embeddings()).toHaveLength(2);
  });
  it('rechecks the actor role and never reuses credentials for another destination', async () => {
    await save({ apiKey: 'secret-key' });
    const [config] = await database.select().from(schema.aiConfiguration);
    expect(config!.apiKey).not.toContain('secret-key');
    expect(openCredential(config!.apiKey)).toBe('secret-key');
    expect(
      (
        await resolveProvider({
          embedding: { ...config!.embedding, baseUrl: `${fake.url}/elsewhere` },
        })
      ).apiKey,
    ).toBeNull();
    expect(() => openCredential(sealCredential('a')!.slice(2))).toThrow('cannot be opened');
    await database.update(schema.user).set({ role: 'user' }).where(eq(schema.user.id, 'owner'));
    await expect(save({ enabled: false })).rejects.toBeInstanceOf(AiAccessDenied);
  });
  it('preserves ancestry, Any/All, untagged, primary color and archive filters', async () => {
    await save();
    await run();
    await run();
    await database.insert(schema.tags).values([
      { id: ROOT, userId: 'owner', name: 'Root', color: 'blue' },
      { id: CHILD, userId: 'owner', name: 'Child', parentId: ROOT },
      { id: SECOND, userId: 'owner', name: 'Second', color: 'red' },
    ]);
    await database
      .insert(schema.noteTags)
      .values({ id: NOTE, userId: 'owner', primaryTagId: CHILD, secondaryTagIds: [SECOND] });
    expect(await rank('owner', { tags: [ROOT, SECOND], match: 'all', color: 'blue' })).toEqual([
      NOTE,
    ]);
    expect(await rank('owner', { tags: [CHILD], color: 'red' })).toEqual([]);
    expect(await rank('owner', { tags: [ROOT, OTHER], match: 'any' })).toEqual([NOTE]);
    expect(await rank('owner', { tags: [ROOT, OTHER], match: 'all' })).toEqual([]);
    expect(await rank('owner', { untagged: true })).toEqual([]);
    await database.update(schema.notes).set({ isArchived: true }).where(eq(schema.notes.id, NOTE));
    expect(await rank('owner', { showArchived: false })).toEqual([]);
    await database.delete(schema.noteTags);
    expect(await rank('owner', { untagged: true })).toEqual([NOTE]);
  });
  it('authorizes shared copies before ranking, respects reader archive/color and revokes immediately', async () => {
    await save();
    await run();
    await run();
    await database
      .insert(schema.noteShares)
      .values({ noteId: NOTE, userId: 'owner', token: TOKEN });
    await database.insert(schema.sharedNotes).values({
      userId: 'reader',
      ownerId: 'owner',
      ownerName: 'Owner',
      noteId: NOTE,
      token: TOKEN,
      color: 'blue',
      position: 'a1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(await rank('reader', { color: 'blue', untagged: true })).toEqual([NOTE]);
    await database.update(schema.sharedNotes).set({ isArchived: true });
    expect(await rank('reader', { color: 'blue', showArchived: false })).toEqual([]);
    await database.update(schema.noteShares).set({ token: 'b'.repeat(43) });
    expect(await rank('reader', { color: 'blue' })).toEqual([]);
  });
  it('safely splits literal keyword terms and fuses them with semantic results', async () => {
    await save();
    await connection`UPDATE notes SET search_text = 'a+b 100% _quoted_ café' WHERE id = ${NOTE}`;
    const hits = await hybridSearch('owner', query({ query: '  a+b\t100%  ' }));
    expect(hits.hits).toEqual([expect.objectContaining({ id: NOTE, semantic: false })]);
    expect((await hybridSearch('owner', query({ query: "'; DROP TABLE notes; --" }))).hits).toEqual(
      [],
    );
  });
  it('model discovery alone does not verify embeddings or enable indexing', async () => {
    const embedding = {
      ...DEFAULT_EMBEDDING_CONFIGURATION,
      provider: 'compatible',
      baseUrl: fake.url,
      model: 'chat-only',
    };
    const request = (path: string) =>
      app.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embedding }),
      });
    expect((await request('/models')).status).toBe(200);
    const tested = await request('/test');
    expect(tested.status).toBe(502);
    expect(await tested.text()).not.toContain('private text');
    expect((await overview()).enabled).toBe(false);
  });
  it('drains an active provider call for in-app restore and resumes restored jobs', async () => {
    await save();
    const backup = await createBackup(fixture.backupConfig!, {
      kind: 'manual',
      includeAttachments: false,
    });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.state.beforeReply = async () => {
      enter();
      await released;
    };
    startEmbeddingWorker();
    await entered;
    try {
      const oldLeases = new Set(
        (await jobs()).map((job) => job.lease).filter((lease) => lease !== null),
      );
      expect(oldLeases.size).toBeGreaterThan(0);
      await runRestore(backup, null);
      expect((await backupOverview()).lastRestore).toMatchObject({ name: backup, error: null });
      // A resumed worker may already have new leases; none can belong to the drained worker.
      expect((await jobs()).every((job) => job.lease === null || !oldLeases.has(job.lease))).toBe(
        true,
      );
    } finally {
      fake.state.beforeReply = null;
      release();
    }
    await vi.waitFor(async () => expect((await overview()).progress.ready).toBe(2), {
      timeout: 10_000,
    });
    await pauseEmbeddingWorker();
  }, 60_000);
});
