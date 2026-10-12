import {
  type HistoryCapture,
  type HistoryList,
  type HistoryVersion,
  historyCaptureSchema,
  historyListSchema,
  historyVersionSchema,
} from '@catch/shared';
import { z } from 'zod';
import { getSignedInUser } from './auth';

const recordSchema = z.object({
  id: z.string(),
  noteId: z.string(),
  epoch: z.string(),
  capture: historyCaptureSchema.nullable(),
  fallback: historyCaptureSchema.nullable(),
  version: historyVersionSchema.extend({ data: z.string(), format: z.literal(1) }).nullable(),
  pending: z.boolean(),
  rejected: z.boolean().default(false),
  cachedAt: z.number(),
});
export type StoredHistory = z.infer<typeof recordSchema>;
const databases = new Map<string, Promise<IDBDatabase>>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
export const subscribeHistoryStorage = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

async function openHistory(userId = getSignedInUser()?.id) {
  if (!userId) throw new Error('Sign in to keep history on this device.');
  let promise = databases.get(userId);
  if (!promise) {
    promise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`catch-history-${userId}`, 2);
      request.onupgradeneeded = () => {
        for (const [name, keyPath] of [
          ['versions', 'id'],
          ['drafts', 'noteId'],
          ['lists', 'noteId'],
          ['restores', 'noteId'],
        ] as const) {
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath });
        }
        const versions = request.transaction!.objectStore('versions');
        if (!versions.indexNames.contains('noteId')) versions.createIndex('noteId', 'noteId');
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => {
          request.result.close();
          databases.delete(userId);
        };
        resolve(request.result);
      };
      request.onerror = () => {
        databases.delete(userId);
        reject(request.error);
      };
    });
    databases.set(userId, promise);
  }
  return promise;
}
async function access<T>(
  storeName: 'versions' | 'drafts' | 'lists' | 'restores',
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openHistory();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const result = operation(tx.objectStore(storeName));
    tx.oncomplete = () => {
      if (mode === 'readwrite') notify();
      resolve(result.result);
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function storeHistoryRecord(record: StoredHistory) {
  await access('versions', 'readwrite', (store) => store.put(recordSchema.parse(record)));
  void navigator.storage?.persist?.().catch(() => {});
}
export async function getHistoryRecord(id: string): Promise<StoredHistory | null> {
  const value: unknown = await access('versions', 'readonly', (store) => store.get(id));
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export async function allHistoryRecords(): Promise<StoredHistory[]> {
  const values: unknown[] = await access('versions', 'readonly', (store) => store.getAll());
  return values.flatMap((value) => {
    const parsed = recordSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
export async function historyRecordsForNote(noteId: string): Promise<StoredHistory[]> {
  const values: unknown[] = await access('versions', 'readonly', (store) =>
    store.index('noteId').getAll(noteId),
  );
  return values.flatMap((value) => {
    const parsed = recordSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
export async function cacheHistoryVersion(version: HistoryVersion & { data: string; format: 1 }) {
  const previous = await getHistoryRecord(version.id);
  await storeHistoryRecord({
    id: version.id,
    noteId: version.noteId,
    epoch: version.epoch,
    capture: previous?.capture ?? null,
    fallback: null,
    version,
    pending: false,
    rejected: false,
    cachedAt: Date.now(),
  });
}
export async function markHistoryUploaded(id: string, version?: HistoryVersion | null) {
  const record = await getHistoryRecord(id);
  if (!record) return;
  await storeHistoryRecord({
    ...record,
    pending: false,
    fallback: null,
    version:
      version?.id === id && record.capture
        ? { ...version, data: record.capture.data, format: 1 }
        : record.version,
  });
}
export async function markHistoryRejected(id: string) {
  const record = await getHistoryRecord(id);
  if (record) await storeHistoryRecord({ ...record, pending: false, rejected: true });
}
export async function forgetClearedHistory(noteId: string, epoch: string) {
  const rows = await historyRecordsForNote(noteId);
  const db = await openHistory();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('versions', 'readwrite');
    for (const row of rows)
      if (row.epoch === epoch && !row.pending && !row.rejected)
        tx.objectStore('versions').delete(row.id);
    tx.oncomplete = () => {
      notify();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const storeHistoryDraft = (capture: HistoryCapture) =>
  access('drafts', 'readwrite', (store) => store.put(capture));
export async function historyDrafts(): Promise<HistoryCapture[]> {
  const values: unknown[] = await access('drafts', 'readonly', (store) => store.getAll());
  return values.flatMap((value) => {
    const parsed = historyCaptureSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}
export async function stageFrozenHistory(capture: HistoryCapture, fallback: HistoryCapture) {
  const db = await openHistory();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['versions', 'drafts'], 'readwrite');
    tx.objectStore('versions').put({
      id: capture.id,
      noteId: capture.noteId,
      epoch: capture.epoch,
      capture,
      fallback,
      version: null,
      pending: true,
      rejected: false,
      cachedAt: Date.now(),
    } satisfies StoredHistory);
    tx.objectStore('drafts').delete(capture.noteId);
    tx.oncomplete = () => {
      notify();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const deleteHistoryDraft = (noteId: string) =>
  access('drafts', 'readwrite', (store) => store.delete(noteId));
export const cacheHistoryList = (noteId: string, list: HistoryList) =>
  access('lists', 'readwrite', (store) => store.put({ noteId, list }));
export async function cachedHistoryList(noteId: string): Promise<HistoryList | null> {
  const value: unknown = await access('lists', 'readonly', (store) => store.get(noteId));
  const parsed = z.object({ list: historyListSchema }).safeParse(value);
  return parsed.success ? parsed.data.list : null;
}
export const storePendingRestore = (noteId: string, operationId: string) =>
  access('restores', 'readwrite', (store) => store.put({ noteId, operationId }));
export const deletePendingRestore = (noteId: string) =>
  access('restores', 'readwrite', (store) => store.delete(noteId));
export async function pendingRestore(noteId: string) {
  const value: unknown = await access('restores', 'readonly', (store) => store.get(noteId));
  const parsed = z.object({ operationId: z.string() }).safeParse(value);
  return parsed.success ? parsed.data.operationId : null;
}

/** Evict complete note caches; never evict an unsynced capture or its dependencies. */
export async function trimHistoryCache() {
  const records = await allHistoryRecords();
  const pinned = new Set((await historyDrafts()).map((draft) => draft.noteId));
  for (const row of records) if (row.pending || row.rejected) pinned.add(row.noteId);
  const size = (row: StoredHistory) =>
    (row.capture?.data.length ?? row.version?.data.length ?? 0) + (row.fallback?.data.length ?? 0);
  let bytes = records.reduce((sum, row) => sum + size(row), 0);
  const byNote = new Map<string, StoredHistory[]>();
  for (const row of records) byNote.set(row.noteId, [...(byNote.get(row.noteId) ?? []), row]);
  const groups = [...byNote.values()].sort(
    (a, b) => Math.max(...a.map((r) => r.cachedAt)) - Math.max(...b.map((r) => r.cachedAt)),
  );
  const remove: string[] = [];
  for (const group of groups) {
    if (bytes <= 256 * 1024 * 1024) break;
    if (pinned.has(group[0]!.noteId)) continue;
    for (const row of group) {
      bytes -= size(row);
      remove.push(row.id);
    }
  }
  if (!remove.length) return;
  const db = await openHistory();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('versions', 'readwrite');
    for (const id of remove) tx.objectStore('versions').delete(id);
    tx.oncomplete = () => {
      notify();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
export async function deleteHistoryStorage(userId: string) {
  const opened = databases.get(userId);
  databases.delete(userId);
  if (opened) (await opened).close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(`catch-history-${userId}`);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Catch windows before signing out.'));
  });
}
