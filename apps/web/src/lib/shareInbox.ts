import { MAX_ATTACHMENT_BYTES } from '@catch/shared';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';

const sharedFileSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  name: z.string(),
  blob: z.instanceof(Blob),
});
export const incomingShareSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  title: z.string(),
  text: z.string(),
  url: z.string(),
  files: z.array(sharedFileSchema),
  userId: z.string().nullable(),
  complete: z.boolean(),
});
export type IncomingShare = z.infer<typeof incomingShareSchema>;

// This inbox is reachable before login, and by both the service worker and the page.
// A share is bound to an account before any note or attachment is written.
async function transact<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('catch-incoming-shares', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('shares', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('shares', mode);
      const request = action(tx.objectStore('shares'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function getIncomingShare(id: string): Promise<IncomingShare | null> {
  const value: unknown = await transact('readonly', (store) => store.get(id));
  return value === undefined ? null : incomingShareSchema.parse(value);
}

export async function saveIncomingShare(share: IncomingShare) {
  incomingShareSchema.parse(share);
  await transact('readwrite', (store) => store.put(share));
}

export const deleteIncomingShare = (id: string) =>
  transact('readwrite', (store) => store.delete(id));

export async function clearIncomingShares(userId: string) {
  const shares: unknown[] = await transact('readonly', (store) => store.getAll());
  for (const value of shares) {
    const share = incomingShareSchema.parse(value);
    if (share.userId === userId) await deleteIncomingShare(share.id);
  }
}

export async function pendingIncomingShares() {
  const values: unknown[] = await transact('readonly', (store) => store.getAll());
  return values.map((value) => incomingShareSchema.parse(value)).filter((share) => !share.complete);
}

export function validateSharedFiles(files: readonly { name: string; blob: Blob }[]) {
  if (files.length > 20) throw new Error('Share up to 20 files at a time.');
  for (const file of files) {
    if (!file.blob.size) throw new Error(`${file.name || 'The shared file'} is empty.`);
    if (file.blob.size > MAX_ATTACHMENT_BYTES) throw new Error('Share files smaller than 100 MB.');
  }
}

/** Store the POST before redirecting, so offline startup and login cannot lose its body. */
export async function captureWebShare(form: FormData) {
  const files = form
    .getAll('files')
    .filter((value): value is File => typeof value !== 'string')
    // Browsers can submit an unselected file input as an empty, unnamed file.
    .filter((file) => file.name || file.size)
    .map((file) => ({ id: uuidv7(), name: file.name || 'Attachment', blob: file }));
  validateSharedFiles(files);
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === 'string' ? value : '';
  };
  const share: IncomingShare = {
    id: uuidv7(),
    title: field('title'),
    text: field('text'),
    url: field('url'),
    files,
    userId: null,
    complete: false,
  };
  if (![share.title, share.text, share.url].some((value) => value.trim()) && !files.length)
    throw new Error('The other app did not send any content.');
  await saveIncomingShare(share);
  return share.id;
}
