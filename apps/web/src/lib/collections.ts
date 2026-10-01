import {
  type Attachment,
  attachmentSchema,
  boardColumnSchema,
  createAttachmentSchema,
  createBoardColumnSchema,
  createNoteSchema,
  type LinkPreview,
  linkPreviewSchema,
  MAX_NOTES_PER_REQUEST,
  noteSchema,
  type TxidResponse,
  updateAttachmentSchema,
  updateBoardColumnSchema,
  updateNoteSchema,
} from '@catch/shared';
import { snakeCamelMapper } from '@electric-sql/client';
import {
  type PersistedCollectionPersistence,
  type PersistedSyncWrappedOptions,
  persistedCollectionOptions,
} from '@tanstack/db-sqlite-persistence-core';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import {
  NonRetriableError,
  type OfflineConfig,
  type OfflineTransaction,
  startOfflineExecutor,
  WebLocksLeader,
} from '@tanstack/offline-transactions';
import {
  createCollection,
  type PendingMutation,
  type Transaction,
  useLiveQuery,
} from '@tanstack/react-db';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { ApiError, api } from './api';
import {
  clearAttachmentFiles,
  getAttachmentBlob,
  markAttachmentUploaded,
  refreshAttachmentUrls,
} from './attachmentFiles';
import { getAuthToken, resolveSignedInUser } from './auth';
import { CompatibilityError, compatibleShapeFetch } from './compatibility';
import {
  createOnlineDetector,
  createOutboxStorage,
  deleteOutbox,
  openLocalDatabase,
} from './localStore';
import { mergeQueuedWrites } from './mergeQueuedWrites';
import { getServerUrl } from './serverUrl';
import { clearIncomingShares } from './shareInbox';
import { addPendingWrite, getSyncStatus, settlePendingWrite, updateSyncStatus } from './syncStatus';

// Collections read from and write to the signed-in user's store on this device, so notes
// show and can be edited without a connection (ADR 0007).
const user = await resolveSignedInUser();
const database = user ? await openLocalDatabase(user.id) : null;

/** Keeps nothing: without a database, collections live in memory as they did before. */
const memoryOnly: PersistedCollectionPersistence = {
  adapter: {
    loadSubset: async () => [],
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  },
};
const persistence = database?.persistence ?? memoryOnly;

/**
 * Adds the database to a synced collection's options. The wrapper swaps in a `sync` that
 * serves rows from the database first and saves synced changes to it; the rest of the
 * options, and so the collection's types, stay as they were.
 *
 * Bump `schemaVersion` whenever the columns the collection's shape syncs change (in the
 * server's `routes/shapes.ts` or the shared schema). Devices then drop their copy of the
 * collection and sync it again, rather than reading rows of the old shape.
 */
function persisted<TOptions extends object>(options: TOptions, schemaVersion: number): TOptions {
  return persistedCollectionOptions({
    ...(options as PersistedSyncWrappedOptions<object, string | number>),
    persistence,
    schemaVersion,
  }) as unknown as TOptions;
}

/**
 * All of the signed-in user's notes, synced from Postgres through Electric. Change them
 * through `write` (see `lib/notes.ts`), never directly.
 */
export const notesCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'notes',
      schema: noteSchema,
      getKey: (note) => note.id,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/notes`,
        fetchClient: compatibleShapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        // Synced rows skip the collection schema, so parse timestamps here.
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

export const boardColumnsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'board-columns',
      schema: boardColumnSchema,
      getKey: (column) => column.id,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/board-columns`,
        fetchClient: compatibleShapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
      },
    }),
    1,
  ),
);

/**
 * What the server found at the links in the user's notes, keyed by normalized URL. Read
 * only: the server adds and fills rows as notes are saved (see `api.refreshLinkPreview`).
 */
export const linkPreviewsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'link-previews',
      schema: linkPreviewSchema,
      getKey: (preview) => preview.url,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/link-previews`,
        fetchClient: compatibleShapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

export const attachmentsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'attachments',
      schema: attachmentSchema,
      getKey: (attachment) => attachment.id,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/attachments`,
        fetchClient: compatibleShapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

const writableCollections = {
  notes: notesCollection,
  boardColumns: boardColumnsCollection,
  attachments: attachmentsCollection,
};

/** How long to wait for Electric to stream a write back before letting it settle anyway. */
const SYNC_WAIT_MS = 30_000;

/**
 * Sends one queued transaction to the API, then waits until Electric streams it back so the
 * optimistic state hands over to synced rows without flicker. The outbox retries whatever
 * this throws, except `NonRetriableError`, which drops the write and rolls it back.
 */
async function pushWrites({ transaction }: Parameters<OfflineConfig['mutationFns'][string]>[0]) {
  let sent: { collectionId: string; txid: TxidResponse['txid'] }[];
  try {
    sent = await Promise.all(
      requestsFor(transaction.mutations).map(async ({ collectionId, request }) => ({
        collectionId,
        txid: (await request())?.txid ?? null,
      })),
    );
  } catch (error) {
    const classified = classifyWriteError(error);
    if (classified instanceof NonRetriableError) settlePendingWrite(transaction.id);
    throw classified;
  }
  updateSyncStatus({ offline: false, signedOut: false });
  settlePendingWrite(transaction.id);
  await Promise.all(
    sent.flatMap(({ collectionId, txid }) => {
      if (txid === null) return [];
      const collection =
        collectionId === notesCollection.id
          ? notesCollection
          : collectionId === attachmentsCollection.id
            ? attachmentsCollection
            : boardColumnsCollection;
      // The server has the write; a slow stream only delays the hand-over.
      return [collection.utils.awaitTxId(txid, SYNC_WAIT_MS).catch(() => false)];
    }),
  );
}

/**
 * The API calls a transaction makes. New notes go together, a request's worth at a time,
 * so an import or a copy of many notes does not send a request for each.
 */
function requestsFor(mutations: readonly PendingMutation[]) {
  const newNotes = mutations.filter(
    (mutation) => mutation.collection.id === notesCollection.id && mutation.type === 'insert',
  );
  const batched = newNotes.length > 1 ? new Set(newNotes) : new Set<PendingMutation>();
  const requests = mutations
    .filter((mutation) => !batched.has(mutation))
    .map((mutation) => ({ collectionId: mutation.collection.id, request: () => send(mutation) }));
  for (let start = 0; start < batched.size; start += MAX_NOTES_PER_REQUEST) {
    const chunk = newNotes.slice(start, start + MAX_NOTES_PER_REQUEST);
    requests.push({
      collectionId: notesCollection.id,
      request: () =>
        api.createNotes({
          notes: chunk.map((mutation) => createNoteSchema.parse(mutation.modified)),
        }),
    });
  }
  return requests;
}

/** The API call for one mutation, or null when there is nothing to send. */
function send(mutation: PendingMutation): Promise<TxidResponse> | null {
  const key = String(mutation.key);
  if (mutation.collection.id === notesCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return api.createNote(createNoteSchema.parse(mutation.modified));
      case 'update': {
        const changes = updateNoteSchema.parse(mutation.changes);
        // Saving unchanged content leaves only `updatedAt`, which the server owns. Such a
        // write changes no synced column, so Electric would never stream its txid back.
        if (Object.keys(changes).length === 0) return null;
        return api.updateNote(key, changes);
      }
      case 'delete':
        return api.deleteNote(key);
    }
  }
  if (mutation.collection.id === boardColumnsCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return api.createBoardColumn(createBoardColumnSchema.parse(mutation.modified));
      case 'update':
        return api.updateBoardColumn(key, updateBoardColumnSchema.parse(mutation.changes));
      case 'delete':
        return api.deleteBoardColumn(key);
    }
  }
  if (mutation.collection.id === attachmentsCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return sendAttachment(createAttachmentSchema.parse(mutation.modified));
      case 'update':
        return api.updateAttachment(key, updateAttachmentSchema.parse(mutation.changes));
      case 'delete':
        return api.updateAttachment(key, { deletedAt: new Date() });
    }
  }
  throw new NonRetriableError(`Writes to ${mutation.collection.id} are not supported`);
}

async function sendAttachment(body: ReturnType<typeof createAttachmentSchema.parse>) {
  const created = await api.createAttachment(body);
  if (body.sourceId) return created;
  const blob = await getAttachmentBlob(body.id);
  if (!blob) throw new NonRetriableError('The attachment file is missing on this device');
  const result = await api.uploadAttachment(body.id, blob);
  await markAttachmentUploaded(body.id);
  return result;
}

/**
 * Sorts a failed write into one to retry (the connection or the server may come back, or
 * the user may sign in again) and one that will never succeed. Retried errors get fixed
 * messages: the outbox gives up on any whose message mentions some 4xx status codes.
 */
function classifyWriteError(error: unknown): Error {
  // A protocol mismatch must never become a permanent rejection that discards local edits.
  if (error instanceof CompatibilityError) return new Error(error.message);
  if (error instanceof NonRetriableError) return reject(error.message);
  if (error instanceof z.ZodError) return reject('Invalid change');
  if (error instanceof ApiError) {
    if (error.status === 401) {
      updateSyncStatus({ signedOut: true });
      return new Error('Waiting for sign-in');
    }
    if (error.status >= 500 || error.status === 408 || error.status === 429) {
      updateSyncStatus({ offline: true });
      return new Error('Server unavailable');
    }
    // A 404 is an edit to a note or column deleted on another device before it arrived.
    return reject(
      error.status === 404 ? 'It was deleted on another device.' : 'The server turned it down.',
    );
  }
  // `fetch` rejects when the server cannot be reached.
  updateSyncStatus({ offline: true });
  return new Error('Server unreachable');
}

function reject(reason: string) {
  reportUnsaved(reason);
  return new NonRetriableError(reason);
}

function reportUnsaved(reason: string) {
  toast.error('A change could not be saved', { description: reason });
}

const onlineDetector = createOnlineDetector();

/**
 * The outbox: writes are stored on the device before they are sent, and sent in order,
 * retrying until the server has them. Only one tab per user keeps the outbox; the others
 * send their writes straight away and need a connection.
 */
const executor = startOfflineExecutor({
  collections: writableCollections,
  mutationFns: { push: pushWrites },
  storage: createOutboxStorage(user?.id ?? null),
  // Without Web Locks the executor falls back to electing a leader over a BroadcastChannel.
  leaderElection: WebLocksLeader.isSupported()
    ? new WebLocksLeader(`catch-outbox-${user?.id ?? ''}`)
    : undefined,
  onlineDetector,
  beforeRetry: (queued: OfflineTransaction[]) => mergeQueuedWrites(queued, notesCollection.id),
  onLeadershipChange: (isLeader) => updateSyncStatus({ sharedTab: !isLeader }),
});

const updateConnection = () => updateSyncStatus({ offline: !onlineDetector.isConnected() });
updateConnection();
window.addEventListener('offline', updateConnection);
onlineDetector.subscribe(updateConnection);

// Restores the writes an earlier visit left in the outbox, so they show until they sync.
await executor.waitForInit();
for (const queued of await executor.peekOutbox()) addPendingWrite(queued.id);

/**
 * Applies the changes `mutate` makes to the collections optimistically and queues them for
 * the server. The returned transaction's `isPersisted.promise` settles once the server has
 * them, which offline can be much later.
 */
export function write(mutate: () => void): Transaction {
  const offline = executor.createOfflineTransaction({ mutationFnName: 'push', autoCommit: false });
  const transaction = offline.mutate(mutate);
  addPendingWrite(transaction.id);
  offline.commit().then(
    () => settlePendingWrite(transaction.id),
    (error: unknown) => {
      settlePendingWrite(transaction.id);
      // `pushWrites` reports the changes the server refused. Anything else failed on the
      // device: in a tab without the outbox, a write that could not be sent straight away.
      if (!(error instanceof NonRetriableError)) {
        reportUnsaved(
          getSyncStatus().sharedTab
            ? 'Catch is open in another tab, and only that tab can save changes offline.'
            : 'It could not be stored on this device.',
        );
      }
    },
  );
  return transaction;
}

/** Incoming shares must survive a reload before they leave their staging inbox. */
export async function waitForWriteStored(transaction: Transaction): Promise<void> {
  await waitForQueuedWrite(transaction.id, transaction.isPersisted.promise);
}

export async function waitForQueuedWrite(id: string, completion: Promise<unknown>): Promise<void> {
  let finished = false;
  const persisted = completion.finally(() => {
    finished = true;
  });
  const queued = (async () => {
    const deadline = Date.now() + 10_000;
    while (!finished && Date.now() < deadline) {
      if ((await executor.peekOutbox()).some((queued) => queued.id === id)) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!finished)
      throw new Error('Could not save the share. Close other Catch windows and try again.');
    return persisted;
  })();
  await Promise.race([persisted, queued]);
}

/** Hydrate device rows without waiting for Electric's first online snapshot. */
export async function loadShareCollections() {
  await Promise.all(
    [notesCollection, attachmentsCollection].map(async (collection) => {
      collection.startSyncImmediate();
      await collection._sync.loadSubset({});
    }),
  );
}

/**
 * Signs out of this device: forgets writes that have not synced and deletes the device's
 * copy of the user's data. The page must reload afterwards.
 */
export async function clearLocalData() {
  await executor.clearOutbox();
  executor.dispose();
  await clearAttachmentFiles();
  if (user) await clearIncomingShares(user.id);
  await database?.destroy();
  if (user) deleteOutbox(user.id);
}

/**
 * Keeps the user's notes synced while the calling page is open, for pages that change notes
 * without showing them: an import has to know which notes are here and where they end.
 * Returns whether the notes have synced with the server, which offline they never do.
 */
export function useSyncedNotes() {
  const [synced, setSynced] = useState(() => notesCollection.isReady());
  useEffect(() => {
    // A subscriber also keeps the collection from being cleaned up while the page is open.
    const subscription = notesCollection.subscribeChanges(() => {});
    const stopWaiting = notesCollection.onFirstReady(() => setSynced(true));
    return () => {
      stopWaiting();
      subscription.unsubscribe();
    };
  }, []);
  return synced;
}

export function useSyncedAttachments() {
  const [synced, setSynced] = useState(() => attachmentsCollection.isReady());
  useEffect(() => {
    const subscription = attachmentsCollection.subscribeChanges(() => {});
    const stopWaiting = attachmentsCollection.onFirstReady(() => setSynced(true));
    return () => {
      stopWaiting();
      subscription.unsubscribe();
    };
  }, []);
  return synced;
}

/** The signed-in user's Deck columns, unordered. */
export function useBoardColumns() {
  const { data = [] } = useLiveQuery((q) => q.from({ column: boardColumnsCollection }));
  return data;
}

// Every card on a page reads previews, so they share one subscription instead of a live
// query each.
let previewsByUrl: ReadonlyMap<string, LinkPreview> = new Map();
const previewListeners = new Set<() => void>();
let previewsSubscribed = false;

function subscribeToPreviews(listener: () => void) {
  previewListeners.add(listener);
  if (previewsSubscribed) return () => previewListeners.delete(listener);
  previewsSubscribed = true;
  // Kept for the session, like the collection's own sync.
  linkPreviewsCollection.subscribeChanges(
    () => {
      previewsByUrl = new Map(
        [...linkPreviewsCollection.values()].map((preview) => [preview.url, preview]),
      );
      for (const notify of previewListeners) notify();
    },
    { includeInitialState: true },
  );
  return () => previewListeners.delete(listener);
}

/** The user's link previews by URL. */
export function useLinkPreviews(): ReadonlyMap<string, LinkPreview> {
  return useSyncExternalStore(subscribeToPreviews, () => previewsByUrl);
}

let attachmentRows: readonly Attachment[] = [];
const attachmentListeners = new Set<() => void>();
let attachmentsSubscribed = false;
function subscribeAttachments(listener: () => void) {
  attachmentListeners.add(listener);
  if (!attachmentsSubscribed) {
    attachmentsSubscribed = true;
    attachmentsCollection.subscribeChanges(
      () => {
        attachmentRows = [...attachmentsCollection.values()];
        for (const notify of attachmentListeners) notify();
        refreshAttachmentUrls();
      },
      { includeInitialState: true },
    );
  }
  return () => {
    attachmentListeners.delete(listener);
  };
}
export function useAttachments(): readonly Attachment[] {
  return useSyncExternalStore(subscribeAttachments, () => attachmentRows);
}
