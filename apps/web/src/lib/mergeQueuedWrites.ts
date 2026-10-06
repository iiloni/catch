import type { OfflineTransaction } from '@tanstack/offline-transactions';

const CONTENT_SAVE_FIELDS = new Set(['content', 'updatedAt']);

/**
 * Drops queued content saves that a later queued save of the same note replaces. Autosave
 * queues the whole note every time typing pauses, so an hour offline can leave hundreds of
 * saves where only the last one matters. Saves that change anything else are kept, and so
 * is the order of everything that stays.
 *
 * It also puts the queue back in the order it was written. The outbox stores writes under
 * random ids and orders them by a time in milliseconds, so two made in one go (a new tag
 * and its assignment) could swap after a reload, and the server refused the one that came
 * first. Each write's idempotency key is a UUIDv7 (see `write`), which keeps their order.
 */
export function mergeQueuedWrites(
  queued: readonly OfflineTransaction[],
  notesCollectionId: string,
): OfflineTransaction[] {
  const ordered = [...queued].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.idempotencyKey < b.idempotencyKey ? -1 : a.idempotencyKey > b.idempotencyKey ? 1 : 0),
  );
  const laterContentSaves = new Set<string>();
  const kept: OfflineTransaction[] = [];
  for (const transaction of ordered.reverse()) {
    const [only, ...others] = transaction.mutations;
    const contentSave =
      only !== undefined &&
      others.length === 0 &&
      only.type === 'update' &&
      only.collection.id === notesCollectionId &&
      Object.keys(only.changes).every((field) => CONTENT_SAVE_FIELDS.has(field));
    if (contentSave && laterContentSaves.has(only.globalKey)) continue;
    kept.push(transaction);
    for (const mutation of transaction.mutations) {
      if (mutation.type === 'update' && 'content' in mutation.changes) {
        laterContentSaves.add(mutation.globalKey);
      }
    }
  }
  return kept.reverse();
}
