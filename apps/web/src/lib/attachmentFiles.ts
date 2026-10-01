import { attachmentAccessSchema, attachmentId } from '@catch/shared';
import { useEffect, useState } from 'react';
import { getAuthToken, getSignedInUser } from './auth';
import { compatibleFetch } from './compatibility';
import { getServerUrl } from './serverUrl';

type StoredFile = { id: string; blob: Blob; pending: boolean; preview: boolean; savedAt: number };
let database: Promise<IDBDatabase> | null = null;
const objectUrls = new Map<string, string>();
const listeners = new Set<() => void>();
const accessUrls = new Map<string, { url: string; expires: number }>();
const requests = new Map<string, Promise<string>>();

export function refreshAttachmentUrls() {
  for (const listener of listeners) listener();
}

export async function copyAttachmentFiles(sourceId: string, id: string) {
  for (const preview of [false, true]) {
    const blob = await getAttachmentBlob(sourceId, preview);
    if (blob) await storeAttachmentBlob(id, blob, false, preview);
  }
}

function openFiles() {
  const user = getSignedInUser();
  if (!user) return Promise.reject(new Error('Sign in to store attachments'));
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`catch-files-${user.id}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = null;
      };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function transact<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openFiles();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', mode);
    const request = action(tx.objectStore('files'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const keyFor = (id: string, preview: boolean) => `${id}${preview ? ':preview' : ''}`;

export async function getAttachmentBlob(id: string, preview = false): Promise<Blob | null> {
  const record: unknown = await transact('readonly', (store) => store.get(keyFor(id, preview)));
  return record && typeof record === 'object' && 'blob' in record && record.blob instanceof Blob
    ? record.blob
    : null;
}

export async function storeAttachmentBlob(
  id: string,
  blob: Blob,
  pending = false,
  preview = false,
) {
  const key = keyFor(id, preview);
  await transact('readwrite', (store) =>
    store.put({ id: key, blob, pending, preview, savedAt: Date.now() } satisfies StoredFile),
  );
  if (objectUrls.has(key)) URL.revokeObjectURL(objectUrls.get(key)!);
  objectUrls.set(key, URL.createObjectURL(blob));
  for (const listener of listeners) listener();
  // Ask the browser to retain notes and files under storage pressure. Refusal is harmless.
  void navigator.storage?.persist?.().catch(() => {});
}

export async function markAttachmentUploaded(id: string) {
  const blob = await getAttachmentBlob(id);
  if (blob)
    await transact('readwrite', (store) =>
      store.put({
        id,
        blob,
        pending: false,
        preview: false,
        savedAt: Date.now(),
      } satisfies StoredFile),
    );
}

export async function forgetAttachmentBlob(id: string) {
  for (const preview of [false, true]) {
    const key = keyFor(id, preview);
    await transact('readwrite', (store) => store.delete(key));
    const url = objectUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(key);
    accessUrls.delete(key);
  }
  for (const listener of listeners) listener();
}

export async function clearAttachmentFiles() {
  if (database) (await database).close();
  database = null;
  for (const url of objectUrls.values()) URL.revokeObjectURL(url);
  objectUrls.clear();
  accessUrls.clear();
  const user = getSignedInUser();
  if (user)
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(`catch-files-${user.id}`);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
}

async function authorizedFetch(path: string) {
  const response = await compatibleFetch(`${getServerUrl()}/api/attachments/${path}`, {
    headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` },
  });
  if (!response.ok)
    throw new Error(
      response.status === 404 ? 'Attachment is not available yet' : 'Could not load attachment',
    );
  return response;
}

async function resolveUrl(id: string, preview: boolean) {
  const key = keyFor(id, preview);
  if (objectUrls.has(key)) return objectUrls.get(key)!;
  const local = await getAttachmentBlob(id, preview);
  if (local) {
    const url = URL.createObjectURL(local);
    objectUrls.set(key, url);
    return url;
  }
  // Newly picked images have their original on the device before a thumbnail exists.
  if (preview) {
    const original = await getAttachmentBlob(id);
    if (original?.type.startsWith('image/')) return resolveUrl(id, false);
    const response = await authorizedFetch(`${id}/content?preview=true`);
    await storeAttachmentBlob(id, await response.blob(), false, true);
    return objectUrls.get(key)!;
  }
  const cached = accessUrls.get(key);
  if (cached && cached.expires > Date.now()) return cached.url;
  let response: Response;
  try {
    response = await authorizedFetch(`${id}/access`);
  } catch (error) {
    const thumbnail = await getAttachmentBlob(id, true);
    if (thumbnail) return resolveUrl(id, true);
    throw error;
  }
  const { url } = attachmentAccessSchema.parse(await response.json());
  // Use the configured server origin, including when Vite proxies the API.
  const source = new URL(url);
  const resolved = `${getServerUrl()}${source.pathname}${source.search}`;
  accessUrls.set(key, { url: resolved, expires: Date.now() + 50 * 60 * 1000 });
  return resolved;
}

export function resolveAttachmentUrl(url: string, preview = false): Promise<string> {
  const id = attachmentId(url);
  if (!id) return Promise.resolve(url);
  const key = keyFor(id, preview);
  const active = requests.get(key);
  if (active) return active;
  const request = resolveUrl(id, preview).finally(() => requests.delete(key));
  requests.set(key, request);
  return request;
}

export function useAttachmentUrl(url: string, preview = false) {
  const [source, setSource] = useState<string | null>(() => (attachmentId(url) ? null : url));
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    function refresh() {
      void resolveAttachmentUrl(url, preview).then(
        (value) => {
          if (current) {
            setSource(value);
            setError(false);
          }
        },
        () => {
          if (current) setError(true);
        },
      );
    }
    setSource(attachmentId(url) ? null : url);
    refresh();
    listeners.add(refresh);
    window.addEventListener('online', refresh);
    const timer = window.setInterval(refresh, 45 * 60 * 1000);
    return () => {
      current = false;
      listeners.delete(refresh);
      window.removeEventListener('online', refresh);
      window.clearInterval(timer);
    };
  }, [url, preview]);
  return { source, error };
}

export async function keepAttachmentOffline(id: string) {
  const response = await authorizedFetch(`${id}/content`);
  await storeAttachmentBlob(id, await response.blob());
}
