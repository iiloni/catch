/**
 * The vault key on a device asked to remember it (ADR 0020): sealed under a key of the
 * device's own, which the browser stores as an object scripts can use but never read the
 * bytes of. Both are kept in a database named after the user. Signing out deletes it.
 */
export type KeptVaultKey = { deviceKey: CryptoKey; sealed: string; vault: string };

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
    return kept?.deviceKey instanceof CryptoKey &&
      typeof kept.sealed === 'string' &&
      typeof kept.vault === 'string'
      ? kept
      : null;
  } catch {
    return null;
  }
}

/** Where a device notes that it has seen the user's vault (see `hasSeenVault`). */
export const vaultSeenKey = (userId: string) => `catch-vault:${userId}`;

/** Everything a device keeps about a user's vault besides its synced rows, for signing out. */
export function forgetVault(userId: string) {
  localStorage.removeItem(vaultSeenKey(userId));
  return forgetVaultKey(userId);
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
