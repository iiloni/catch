import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import type { PersistedCollectionPersistence } from '@tanstack/db-sqlite-persistence-core';
import {
  IndexedDBAdapter,
  type OnlineDetector,
  type StorageAdapter,
  WebOnlineDetector,
} from '@tanstack/offline-transactions';

/**
 * The device's copy of one user's synced data, a SQLite database that collections persist
 * to. Each user gets their own, because Electric identifies a shape by its URL alone and
 * every user syncs the same URLs.
 */
export type LocalDatabase = {
  persistence: PersistedCollectionPersistence;
  /** Closes and deletes the database. The page must reload afterwards. */
  destroy: () => Promise<void>;
};

const databaseName = (userId: string) => `catch-${userId}`;
const outboxName = (userId: string) => `catch-outbox-${userId}`;

/** Opens the user's database, or returns null when this device cannot keep one. */
export async function openLocalDatabase(userId: string): Promise<LocalDatabase | null> {
  try {
    const database = Capacitor.isNativePlatform()
      ? await openNativeDatabase(databaseName(userId))
      : await openBrowserDatabase(databaseName(userId));
    // Ask the browser not to evict the database under storage pressure. Installed PWAs are
    // usually granted this; elsewhere it is a hint.
    void navigator.storage?.persist?.().catch(() => false);
    return database;
  } catch (error) {
    // Without a database the app still works online, as it did before offline support.
    console.warn('Local storage is unavailable; notes will not be kept offline.', error);
    return null;
  }
}

/**
 * Where the outbox of writes that have not reached the server is kept: IndexedDB, per user.
 * Signed out there is nothing to write, so it stays in memory.
 */
export function createOutboxStorage(userId: string | null): StorageAdapter {
  return userId ? new IndexedDBAdapter(outboxName(userId), 'transactions') : new MemoryStorage();
}

export function deleteOutbox(userId: string) {
  // Finishes once the outbox's connection closes, at the latest when the page reloads.
  indexedDB.deleteDatabase(outboxName(userId));
}

class MemoryStorage implements StorageAdapter {
  private readonly entries = new Map<string, string>();
  get = async (key: string) => this.entries.get(key) ?? null;
  set = async (key: string, value: string) => void this.entries.set(key, value);
  delete = async (key: string) => void this.entries.delete(key);
  keys = async () => [...this.entries.keys()];
  clear = async () => this.entries.clear();
}

async function openBrowserDatabase(name: string): Promise<LocalDatabase> {
  const {
    BrowserCollectionCoordinator,
    createBrowserWASQLitePersistence,
    openBrowserWASQLiteOPFSDatabase,
  } = await import('@tanstack/browser-db-sqlite-persistence');
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName: `${name}.sqlite` });
  // Tabs share the database: one leader writes to it and relays changes to the others.
  const coordinator = new BrowserCollectionCoordinator({ dbName: name });
  return {
    persistence: createBrowserWASQLitePersistence({ database, coordinator }),
    destroy: async () => {
      coordinator.dispose();
      await database.close?.();
      // The VFS keeps the database and its journals as files named after it.
      const root = await navigator.storage.getDirectory();
      for await (const entryName of root.keys()) {
        if (entryName.startsWith(name)) await root.removeEntry(entryName, { recursive: true });
      }
    },
  };
}

async function openNativeDatabase(name: string): Promise<LocalDatabase> {
  const [{ CapacitorSQLite, SQLiteConnection }, { createCapacitorSQLitePersistence }] =
    await Promise.all([
      import('@capacitor-community/sqlite'),
      import('@tanstack/capacitor-db-sqlite-persistence'),
    ]);
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  // Live reload re-runs this module while the native connection stays open.
  const consistent = (await sqlite.checkConnectionsConsistency()).result;
  const existing = consistent && (await sqlite.isConnection(name, false)).result;
  const connection = existing
    ? await sqlite.retrieveConnection(name, false)
    : await sqlite.createConnection(name, false, 'no-encryption', 1, false);
  if (!(await connection.isDBOpen()).result) await connection.open();
  return {
    persistence: createCapacitorSQLitePersistence({ database: connection }),
    destroy: async () => {
      await connection.delete();
      await sqlite.closeConnection(name, false);
    },
  };
}

/**
 * Whether the device has a network connection. The Android app asks the OS through the
 * Network plugin rather than trusting the WebView's `navigator.onLine`.
 */
export function createOnlineDetector(): OnlineDetector {
  if (!Capacitor.isNativePlatform()) return new WebOnlineDetector();
  return new NativeOnlineDetector();
}

class NativeOnlineDetector extends WebOnlineDetector {
  private connected = navigator.onLine;

  constructor() {
    super();
    void Network.getStatus().then((status) => this.update(status.connected));
    void Network.addListener('networkStatusChange', (status) => this.update(status.connected));
  }

  private update(connected: boolean) {
    if (connected === this.connected) return;
    this.connected = connected;
    // Listeners check `isOnline`, so telling them about a lost connection is harmless.
    this.notifyOnline();
  }

  override isOnline() {
    return this.connected;
  }
}
