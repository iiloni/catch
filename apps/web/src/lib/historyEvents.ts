import type { HistoryState, HistoryVersion, Note } from '@catch/shared';
import { uuidv7 } from 'uuidv7';

/** Content-only hooks keep history independent of pin, tag, location and reminder changes. */
export const historyChanges = new Set<
  (change: { note: Note; before: Note['content']; after: Note['content'] }) => void
>();
/** Keyed content identities are copied into transaction metadata before the vault can lock. */
const sealedContentKeys = new Map<string, string>();
export const rememberHistoryContentKey = (data: string, key: string) =>
  sealedContentKeys.set(data, key);
/** Each ciphertext is written once, so its identity is handed over rather than kept. */
export function takeHistoryContentKey(data: string) {
  const key = sealedContentKeys.get(data);
  sealedContentKeys.delete(data);
  return key;
}
export const clearHistoryContentKeys = () => sealedContentKeys.clear();
export type HistoryChangeState = { before: HistoryState; after: HistoryState };

export const historyOriginId = uuidv7();

export const historyVaultLocked = new Set<() => void>();

export const historyUploaded = new Set<
  (noteId: string, captureId: string, version: HistoryVersion) => void
>();
