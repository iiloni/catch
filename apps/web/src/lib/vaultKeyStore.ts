import { type BiometricSeal, forgetBiometricKey } from './vaultBiometrics';

/**
 * The vault key as a device keeps it between visits (ADR 0020), in a database named after
 * the user. Signing out deletes it.
 *
 * A device asked to remember the vault keeps the key sealed under a key of the device's own,
 * which the browser stores as an object scripts can use but never read the bytes of. A device
 * given a PIN keeps it sealed under the PIN as well, in an entry of its own, and a phone that
 * opens it with a fingerprint keeps the copy its Keystore sealed in a third. An older client
 * reads only the remembered entry, so it ignores the others and asks for the password; had
 * the PIN's copy been in that entry, it would have taken that copy for the key itself.
 */
export type KeptVaultKey = { deviceKey: CryptoKey; sealed: string; vault: string };

/** The vault key sealed under a PIN, and how many wrong PINs were tried since the right one. */
export type KeptVaultPin = KeptVaultKey & {
  salt: string;
  iterations: number;
  /** How many digits the PIN has, so the form can try it once they are all typed. */
  length: number;
  failures: number;
};

/** The vault key as the phone's Keystore sealed it, for opening with a fingerprint. */
export type KeptVaultBiometric = BiometricSeal & { vault: string };

const databaseName = (userId: string) => `catch-vault-${userId}`;
const STORE = 'keys';
const REMEMBERED = 'vault';
const PIN = 'pin';
const BIOMETRIC = 'biometric';

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

const isKept = (kept: Partial<KeptVaultKey> | undefined): kept is KeptVaultKey =>
  kept?.deviceKey instanceof CryptoKey &&
  typeof kept.sealed === 'string' &&
  typeof kept.vault === 'string';

const load = (userId: string, entry: string) =>
  run<Partial<KeptVaultPin> | undefined>(userId, 'readonly', (store) => store.get(entry));

async function remove(userId: string, entry: string) {
  await run(userId, 'readwrite', (store) => store.delete(entry));
}

export async function rememberVaultKey(userId: string, kept: KeptVaultKey) {
  await run(userId, 'readwrite', (store) => store.put(kept, REMEMBERED));
}

/** The remembered key, or null when there is none or this browser cannot keep one. */
export async function loadVaultKey(userId: string): Promise<KeptVaultKey | null> {
  try {
    const kept = await load(userId, REMEMBERED);
    return isKept(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** Forgets the remembered key; a PIN set on the device stays. */
export async function forgetVaultKey(userId: string) {
  try {
    await remove(userId, REMEMBERED);
  } catch {}
}

export async function keepVaultPin(userId: string, kept: KeptVaultPin) {
  await run(userId, 'readwrite', (store) => store.put(kept, PIN));
}

/**
 * The key as the device's PIN seals it, or null when no PIN is set here. Throws when the
 * device cannot be read, which must not be mistaken for there being no PIN.
 */
export async function loadVaultPin(userId: string): Promise<KeptVaultPin | null> {
  const kept = await load(userId, PIN);
  if (!isKept(kept)) return null;
  const { salt, iterations, length, failures } = kept as Partial<KeptVaultPin>;
  return typeof salt === 'string' &&
    typeof iterations === 'number' &&
    typeof length === 'number' &&
    typeof failures === 'number'
    ? { ...kept, salt, iterations, length, failures }
    : null;
}

/** Throws when the device could not delete it, so a PIN turned off cannot come back. */
export const forgetVaultPin = (userId: string) => remove(userId, PIN);

export async function keepVaultBiometric(userId: string, kept: KeptVaultBiometric) {
  await run(userId, 'readwrite', (store) => store.put(kept, BIOMETRIC));
}

/**
 * The key as the phone's Keystore sealed it, or null when fingerprint unlock is off here.
 * Throws when the device cannot be read, which must not be mistaken for it being off.
 */
export async function loadVaultBiometric(userId: string): Promise<KeptVaultBiometric | null> {
  const kept = await run<Partial<KeptVaultBiometric> | undefined>(userId, 'readonly', (store) =>
    store.get(BIOMETRIC),
  );
  return typeof kept?.iv === 'string' &&
    typeof kept.sealed === 'string' &&
    typeof kept.vault === 'string'
    ? { iv: kept.iv, sealed: kept.sealed, vault: kept.vault }
    : null;
}

/** Throws when the device could not delete it, so fingerprint unlock turned off stays off. */
export const forgetVaultBiometric = (userId: string) => remove(userId, BIOMETRIC);

/** Where a device notes that it has seen the user's vault (see `hasSeenVault`). */
export const vaultSeenKey = (userId: string) => `catch-vault:${userId}`;

/** Everything a device keeps about a user's vault besides its synced rows, for signing out. */
export function forgetVault(userId: string) {
  localStorage.removeItem(vaultSeenKey(userId));
  return forgetVaultDevice(userId);
}

/**
 * Forgets every copy of the key this device keeps: remembered, sealed under a PIN, and sealed
 * by the Keystore, whose key goes too so that no copy of it left behind opens again.
 */
export async function forgetVaultDevice(userId: string): Promise<void> {
  await forgetBiometricKey(userId).catch(() => {});
  await new Promise<void>((resolve) => {
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
