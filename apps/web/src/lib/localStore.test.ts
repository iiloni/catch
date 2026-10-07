import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { openLocalDatabase } from './localStore';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@tanstack/browser-db-sqlite-persistence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/browser-db-sqlite-persistence')>()),
  openBrowserWASQLiteOPFSDatabase: mocks.open,
}));

afterEach(() => vi.restoreAllMocks());

it('resyncs an upgraded collection without resetting other collections during leadership', async () => {
  const sqlite = new DatabaseSync(':memory:');
  mocks.open.mockResolvedValue({
    execute: async <T>(sql: string, params: readonly unknown[] = []): Promise<readonly T[]> => {
      try {
        return sqlite.prepare(sql).all(...(params as SQLInputValue[])) as T[];
      } catch (error) {
        // The real OPFS worker serializes SQLite errors and creates an Error in this realm.
        throw new Error(String(error));
      }
    },
    close: () => sqlite.close(),
  });
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, callback: () => Promise<void>) => callback(),
    },
  });
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { getDirectory: async () => ({ keys: async function* () {} }) },
  });
  const local = await openLocalDatabase('schema-routing-test');
  expect(local).not.toBeNull();
  if (!local) throw new Error('Database failed to open');
  try {
    const resolve = local.persistence.resolvePersistenceForCollection;
    if (!resolve) throw new Error('Missing collection resolver');
    const notes = resolve({ collectionId: 'notes', mode: 'sync-present', schemaVersion: 1 });
    const oldShared = resolve({
      collectionId: 'shared-notes',
      mode: 'sync-present',
      schemaVersion: 1,
    });
    await oldShared.adapter.applyCommittedTx('shared-notes', {
      txId: 'old-shared-note',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [{ type: 'insert', key: 'shared', value: { id: 'shared' } }],
      collectionMetadataMutations: [
        { type: 'set', key: 'electric:resume', value: { handle: 'old-shape', offset: '0_inf' } },
      ],
    });
    const shared = resolve({
      collectionId: 'shared-notes',
      mode: 'sync-present',
      schemaVersion: 2,
    });
    await notes.adapter.applyCommittedTx('notes', {
      txId: 'saved-note',
      term: 1,
      seq: 1,
      rowVersion: 1,
      mutations: [{ type: 'insert', key: 'note', value: { id: 'note', text: 'Keep offline' } }],
    });
    await shared.adapter.getStreamPosition?.('shared-notes');
    expect(await shared.adapter.loadCollectionMetadata?.('shared-notes')).toEqual([]);
    expect(await shared.adapter.scanRows?.('shared-notes')).toEqual([]);

    // Leadership reads the stream position through the coordinator, rather than the
    // collection's direct adapter. The previous wiring used shared-notes' version here.
    notes.coordinator?.subscribe('notes', () => {});
    shared.coordinator?.subscribe('shared-notes', () => {});
    await vi.waitFor(() => {
      expect(notes.coordinator?.isLeader('notes')).toBe(true);
      expect(shared.coordinator?.isLeader('shared-notes')).toBe(true);
    });
    expect(await notes.adapter.scanRows?.('notes')).toEqual([
      expect.objectContaining({ key: 'note', value: { id: 'note', text: 'Keep offline' } }),
    ]);
    expect(
      sqlite
        .prepare(
          'SELECT collection_id, schema_version FROM collection_registry ORDER BY collection_id',
        )
        .all(),
    ).toEqual([
      { collection_id: 'notes', schema_version: 1 },
      { collection_id: 'shared-notes', schema_version: 2 },
    ]);
  } finally {
    await local.destroy();
  }
});
