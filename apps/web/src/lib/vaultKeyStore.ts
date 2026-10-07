/**
 * The vault key on a device asked to remember it (ADR 0020). The browser stores the key
 * object itself, which scripts can use but never read the bytes of, in a database named
 * after the user. Signing out deletes it.
 */
export type KeptVaultKey = { key: CryptoKey; vault: string };

const databaseName = (userId: string) => `catch-vault-${userId}`;
const STORE = 'keys';
const ENTRY = 'vault';

function open(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(userId), 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  userId: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open(userId);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function rememberVaultKey(userId: string, kept: KeptVaultKey) {
  await run(userId, 'readwrite', (store) => store.put(kept, ENTRY));
}

/** The remembered key, or null when there is none or this browser cannot keep one. */
export async function loadVaultKey(userId: string): Promise<KeptVaultKey | null> {
  try {
    const kept = await run<KeptVaultKey | undefined>(userId, 'readonly', (store) =>
      store.get(ENTRY),
    );
    return kept?.key instanceof CryptoKey && typeof kept.vault === 'string' ? kept : null;
  } catch {
    return null;
  }
}

export function forgetVaultKey(userId: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(databaseName(userId));
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      // Another tab holds it open; the deletion goes through once that tab lets go.
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
