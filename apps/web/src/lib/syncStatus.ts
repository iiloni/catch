import type { CompatibilityIssue } from '@catch/shared';
import { useSyncExternalStore } from 'react';

export type SyncStatus = {
  /** Writes made on this device that the server does not have yet. */
  pending: number;
  /** The device has no connection, or the server did not answer the last write. */
  offline: boolean;
  /** The server turned the saved token down, so writes wait for the user to sign in again. */
  signedOut: boolean;
  /** Sync waits for an app or server update; local notes and queued writes stay intact. */
  incompatibility: CompatibilityIssue | null;
  /**
   * Another tab keeps this user's outbox, so writes from this one are not queued and need a
   * connection.
   */
  sharedTab: boolean;
};

let status: SyncStatus = {
  pending: 0,
  offline: false,
  signedOut: false,
  sharedTab: false,
  incompatibility: null,
};
const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function updateSyncStatus(changes: Partial<SyncStatus>) {
  const next = { ...status, ...changes };
  if ((Object.keys(next) as (keyof SyncStatus)[]).every((key) => next[key] === status[key])) {
    return;
  }
  status = next;
  for (const listener of listeners) listener();
}

const pendingIds = new Set<string>();
// Remembered so a write that settles before it is counted is never counted.
const settledIds = new Set<string>();

export function getPendingWriteIds() {
  return [...pendingIds];
}

/** Counts the write with this transaction id as pending until `settlePendingWrite`. */
export function addPendingWrite(id: string) {
  if (settledIds.has(id) || pendingIds.has(id)) return;
  pendingIds.add(id);
  updateSyncStatus({ pending: pendingIds.size });
}

export function settlePendingWrite(id: string) {
  settledIds.add(id);
  if (pendingIds.delete(id)) updateSyncStatus({ pending: pendingIds.size });
}

/** Whether the write with this transaction id is waiting for the server. */
export function isPendingWrite(id: string) {
  return pendingIds.has(id);
}

export function subscribeToSyncStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeToSyncStatus, getSyncStatus);
}

/**
 * Whether a page should hold off showing its notes, or that it has none, while collections
 * load. Collections only finish loading once they reach the server, so a page stops waiting
 * as soon as the device's copy has something to show, or when there is no connection.
 */
export function useAwaitingSync(isLoading: boolean, shown: number) {
  const { offline, signedOut, incompatibility } = useSyncStatus();
  return isLoading && shown === 0 && !offline && !signedOut && !incompatibility;
}
