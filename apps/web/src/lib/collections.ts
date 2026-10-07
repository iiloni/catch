import {
  type Attachment,
  attachmentSchema,
  blocksToPlainText,
  boardColumnSchema,
  createAttachmentSchema,
  createBoardColumnSchema,
  createNoteSchema,
  createTagSchema,
  createVaultNoteSchema,
  type LinkPreview,
  linkPreviewSchema,
  MAX_NOTES_PER_REQUEST,
  type NoteTags,
  noteSchema,
  noteTagsSchema,
  type Reminder,
  type ReminderAlarm,
  reminderAlarm,
  reminderSchema,
  saveReminderSchema,
  type Tag,
  type TxidResponse,
  tagSchema,
  updateAttachmentSchema,
  updateBoardColumnSchema,
  updateNoteSchema,
  updateNoteTagsSchema,
  updateTagSchema,
  updateVaultNoteSchema,
  vaultNoteSchema,
  vaultSchema,
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
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { ApiError, api } from './api';
import {
  clearAttachmentFiles,
  getAttachmentBlob,
  markAttachmentUploaded,
  refreshAttachmentUrls,
} from './attachmentFiles';
import { getAuthToken, resolveSignedInUser } from './auth';
import { CompatibilityError } from './compatibility';
import {
  createOnlineDetector,
  createOutboxStorage,
  deleteOutbox,
  openLocalDatabase,
} from './localStore';
import { mergeQueuedWrites } from './mergeQueuedWrites';
import { getServerUrl } from './serverUrl';
import { shapeFetch } from './shapeFetch';
import { clearIncomingShares } from './shareInbox';
import {
  addPendingWrite,
  getPendingWriteIds,
  getSyncStatus,
  settlePendingWrite,
  updateSyncStatus,
  useAwaitingSync,
} from './syncStatus';
import { forgetVaultKey } from './vaultKeyStore';

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
        fetchClient: shapeFetch,
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
        fetchClient: shapeFetch,
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
        fetchClient: shapeFetch,
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
        fetchClient: shapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

export const tagsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'tags',
      schema: tagSchema,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/tags`,
        fetchClient: shapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
      },
    }),
    1,
  ),
);

export const noteTagsCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'note-tags',
      schema: noteTagsSchema,
      getKey: (row) => row.id,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/note-tags`,
        fetchClient: shapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
      },
    }),
    1,
  ),
);

/** Each note's reminder, keyed by the note's id (ADR 0018). */
export const remindersCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'reminders',
      schema: reminderSchema,
      getKey: (reminder) => reminder.noteId,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/reminders`,
        fetchClient: shapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

/**
 * The user's vault (ADR 0020): its key as the server keeps it, sealed. Read only here; the
 * vault's own requests change it (see `lib/vault.ts`).
 */
export const vaultCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'vault',
      schema: vaultSchema,
      getKey: (vault) => vault.userId,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/vault`,
        fetchClient: shapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

/** The vault's notes as ciphertext, which is also all the device's database keeps of them. */
export const vaultNotesCollection = createCollection(
  persisted(
    electricCollectionOptions({
      id: 'vault-notes',
      schema: vaultNoteSchema,
      getKey: (note) => note.id,
      shapeOptions: {
        url: `${getServerUrl()}/api/shapes/vault-notes`,
        fetchClient: shapeFetch,
        headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
        columnMapper: snakeCamelMapper(),
        parser: { timestamptz: (value: string) => new Date(value) },
      },
    }),
    1,
  ),
);

/** Settles once a change the vault's own requests made has synced back, or after a wait. */
export const awaitVaultSync = (txid: number | null) =>
  txid === null
    ? Promise.resolve(false)
    : vaultCollection.utils.awaitTxId(txid, SYNC_WAIT_MS).catch(() => false);

const writableCollections = {
  notes: notesCollection,
  vaultNotes: vaultNotesCollection,
  tags: tagsCollection,
  noteTags: noteTagsCollection,
  boardColumns: boardColumnsCollection,
  attachments: attachmentsCollection,
  reminders: remindersCollection,
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
    sent = [];
    // Notes and parents must exist before dependent rows. Preserve mutation order,
    // also during a retry after only the first requests reached the server.
    for (const { collectionId, request } of requestsFor(transaction.mutations)) {
      sent.push({ collectionId, txid: (await request())?.txid ?? null });
    }
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
        Object.values(writableCollections).find((item) => item.id === collectionId) ??
        notesCollection;
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
  const treeCleanup = mutations.some(
    (mutation) =>
      mutation.collection.id === tagsCollection.id &&
      (mutation.type === 'delete' ||
        (mutation.type === 'update' && mutation.changes.parentId !== undefined)),
  );
  const colorLink = mutations.some(
    (mutation) =>
      mutation.collection.id === tagsCollection.id &&
      mutation.modified.color &&
      (mutation.type === 'insert' ||
        (mutation.type === 'update' &&
          mutation.modified.color !==
            ('color' in mutation.original ? mutation.original.color : undefined))),
  );
  // Derived optimistic cleanup is handled against the server's current assignments.
  // Sending local arrays here would overwrite assignments added on another device.
  const requests = mutations
    .filter(
      (mutation) =>
        !batched.has(mutation) &&
        !((treeCleanup || colorLink) && mutation.collection.id === noteTagsCollection.id) &&
        !(
          colorLink &&
          mutation.collection.id === notesCollection.id &&
          mutation.type === 'update' &&
          Object.keys(mutation.changes).every((key) => key === 'color')
        ),
    )
    .map((mutation) => ({ collectionId: mutation.collection.id, request: () => send(mutation) }));
  for (let start = 0; start < batched.size; start += MAX_NOTES_PER_REQUEST) {
    const chunk = newNotes.slice(start, start + MAX_NOTES_PER_REQUEST);
    requests.splice(start / MAX_NOTES_PER_REQUEST, 0, {
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
  if (mutation.collection.id === tagsCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return api.createTag(createTagSchema.parse(mutation.modified));
      case 'update':
        return api.updateTag(key, updateTagSchema.parse(mutation.changes));
      case 'delete':
        return api.deleteTag(key);
    }
  }
  if (mutation.collection.id === noteTagsCollection.id) {
    if (mutation.type === 'delete') return null; // Server cascades note deletion.
    const body = updateNoteTagsSchema.parse(
      mutation.type === 'insert' ? mutation.modified : mutation.changes,
    );
    if (mutation.type === 'update' && body.primaryTagId !== undefined) {
      // Secondary cleanup when changing a primary is derived on the server as well.
      delete body.secondaryTagIds;
    } else if (mutation.type === 'insert') {
      // A locally missing row does not prove that the other role is empty on the server.
      if (body.primaryTagId === null) delete body.primaryTagId;
      else if (!body.secondaryTagIds?.length) delete body.secondaryTagIds;
    }
    return api.updateNoteTags(key, body);
  }
  if (mutation.collection.id === remindersCollection.id) {
    // A reminder is saved whole, so replaying an insert or an update is the same request.
    return mutation.type === 'delete'
      ? api.deleteReminder(key)
      : api.saveReminder(key, saveReminderSchema.parse(mutation.modified));
  }
  if (mutation.collection.id === vaultNotesCollection.id) {
    switch (mutation.type) {
      case 'insert':
        return api.createVaultNote(createVaultNoteSchema.parse(mutation.modified));
      case 'update':
        // A note is sealed whole, so the latest `data` is the whole change.
        return api.updateVaultNote(key, updateVaultNoteSchema.parse(mutation.modified));
      case 'delete':
        return api.deleteVaultNote(key);
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
    if (error.status === 404) return reject('It was deleted on another device.');
    // A 413 is the server's limit on one request or on an account's attachment storage, or
    // an upload that is not the size it was announced as. The server says which.
    return reject(
      error.status === 413
        ? (serverReason(error.message) ?? 'It is too large for the server.')
        : 'The server turned it down.',
    );
  }
  // `fetch` rejects when the server cannot be reached.
  updateSyncStatus({ offline: true });
  return new Error('Server unreachable');
}

/** The reason in an API error's `{ error }` body, when it has one. */
function serverReason(body: string) {
  try {
    return z.object({ error: z.string().min(1) }).parse(JSON.parse(body)).error;
  } catch {
    return null;
  }
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
  const offline = executor.createOfflineTransaction({
    mutationFnName: 'push',
    autoCommit: false,
    // Ordered within a millisecond, unlike the outbox's own times (see `mergeQueuedWrites`).
    idempotencyKey: uuidv7(),
  });
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

/** Captures must survive a reload or popup closing before confirming success. */
export async function waitForWriteStored(transaction: Transaction): Promise<void> {
  await waitForQueuedWrite(transaction.id, transaction.isPersisted.promise);
}

/** A reload must wait for in-flight writes to reach durable storage or the server. */
export async function waitForPendingWritesStored(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (getPendingWriteIds().length) {
    const queued = new Set((await executor.peekOutbox()).map((write) => write.id));
    if (getPendingWriteIds().every((id) => queued.has(id))) return;
    if (Date.now() >= deadline) {
      throw new Error('Changes are still being saved. Wait a moment and try reloading again.');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
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
      throw new Error('Could not save on this device. Close other Catch windows and try again.');
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
  if (user) await forgetVaultKey(user.id);
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

/** Notes available on this device, including local writes, for capture duplicate checks. */
export function useCaptureNotes() {
  const { data = [] } = useLiveQuery({ query: (q) => q.from({ note: notesCollection }) });
  return data;
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

// As with previews: every card reads its note's reminder.
let remindersByNote: ReadonlyMap<string, Reminder> = new Map();
const reminderListeners = new Set<() => void>();
let remindersSubscribed = false;

function subscribeToReminders(listener: () => void) {
  reminderListeners.add(listener);
  if (remindersSubscribed) return () => reminderListeners.delete(listener);
  remindersSubscribed = true;
  remindersCollection.subscribeChanges(
    () => {
      remindersByNote = new Map(
        [...remindersCollection.values()].map((reminder) => [reminder.noteId, reminder]),
      );
      for (const notify of reminderListeners) notify();
    },
    { includeInitialState: true },
  );
  return () => reminderListeners.delete(listener);
}

/** No reminders is only known once the reminders have synced: they trail the notes. */
export function useRemindersReady() {
  const [ready, setReady] = useState(() => remindersCollection.isReady());
  useEffect(() => remindersCollection.onFirstReady(() => setReady(true)), []);
  return ready;
}

/** The user's reminders by note id. */
export function useReminders(): ReadonlyMap<string, Reminder> {
  return useSyncExternalStore(subscribeToReminders, () => remindersByNote);
}

/**
 * What the Android app should ring (ADR 0018), told again whenever a reminder or a note
 * changes: a notification shows its note's words as they are now.
 */
export function watchReminderAlarms(listener: (alarms: ReminderAlarm[]) => void) {
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  const tell = () => {
    scheduled = undefined;
    listener(
      [...remindersCollection.values()].flatMap((reminder) => {
        const note = notesCollection.get(reminder.noteId);
        if (!note || note.deletedAt) return [];
        return reminderAlarm(reminder, blocksToPlainText(note.content)) ?? [];
      }),
    );
  };
  // Typing in a note changes it on every key; the phone need only hear once it settles.
  const changed = () => {
    if (scheduled === undefined) scheduled = setTimeout(tell, 500);
  };
  const reminders = remindersCollection.subscribeChanges(changed, { includeInitialState: true });
  const notes = notesCollection.subscribeChanges(changed);
  return () => {
    clearTimeout(scheduled);
    reminders.unsubscribe();
    notes.unsubscribe();
  };
}

/**
 * What a note's reminder is snoozed until: null for not snoozed, undefined for no reminder
 * (or none loaded yet).
 */
export const reminderSnooze = (noteId: string) => remindersCollection.get(noteId)?.snoozedUntil;

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

let tagRows: readonly Tag[] = [];
const tagListeners = new Set<() => void>();
let tagSubscribed = false;
function subscribeTags(listener: () => void) {
  tagListeners.add(listener);
  if (!tagSubscribed) {
    tagSubscribed = true;
    tagsCollection.subscribeChanges(
      () => {
        tagRows = [...tagsCollection.values()];
        for (const notify of tagListeners) notify();
      },
      { includeInitialState: true },
    );
  }
  return () => {
    tagListeners.delete(listener);
  };
}
export function useTags(): readonly Tag[] {
  return useSyncExternalStore(subscribeTags, () => tagRows);
}

let assignmentRows: ReadonlyMap<string, NoteTags> = new Map();
const assignmentListeners = new Set<() => void>();
let assignmentsSubscribed = false;
function subscribeNoteTags(listener: () => void) {
  assignmentListeners.add(listener);
  if (!assignmentsSubscribed) {
    assignmentsSubscribed = true;
    noteTagsCollection.subscribeChanges(
      () => {
        assignmentRows = new Map([...noteTagsCollection.values()].map((row) => [row.id, row]));
        for (const notify of assignmentListeners) notify();
      },
      { includeInitialState: true },
    );
  }
  return () => {
    assignmentListeners.delete(listener);
  };
}
export function useNoteTagAssignments(): ReadonlyMap<string, NoteTags> {
  return useSyncExternalStore(subscribeNoteTags, () => assignmentRows);
}

/** An empty cached relationship is meaningful only after its first snapshot online. */
export function useTagReadiness() {
  const [tagsReady, setTagsReady] = useState(() => tagsCollection.isReady());
  const [assignmentsReady, setAssignmentsReady] = useState(() => noteTagsCollection.isReady());
  useEffect(() => {
    const tags = tagsCollection.subscribeChanges(() => {});
    const assignments = noteTagsCollection.subscribeChanges(() => {});
    const stopTags = tagsCollection.onFirstReady(() => setTagsReady(true));
    const stopAssignments = noteTagsCollection.onFirstReady(() => setAssignmentsReady(true));
    return () => {
      stopTags();
      stopAssignments();
      tags.unsubscribe();
      assignments.unsubscribe();
    };
  }, []);
  return {
    awaitingTags: useAwaitingSync(!tagsReady, 0),
    awaitingAssignments: useAwaitingSync(!assignmentsReady, 0),
  };
}
