import {
  boardColumnSchema,
  createBoardColumnSchema,
  createNoteSchema,
  type LinkPreview,
  linkPreviewSchema,
  noteSchema,
  updateBoardColumnSchema,
  updateNoteSchema,
} from '@catch/shared';
import { snakeCamelMapper } from '@electric-sql/client';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import { createCollection, useLiveQuery } from '@tanstack/react-db';
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { getAuthToken } from './auth';
import { getServerUrl } from './serverUrl';

/**
 * All of the signed-in user's notes, synced from Postgres through Electric.
 * Writes apply optimistically, go to the API, and settle once Electric streams
 * the same transaction back.
 */
export const notesCollection = createCollection(
  electricCollectionOptions({
    id: 'notes',
    schema: noteSchema,
    getKey: (note) => note.id,
    shapeOptions: {
      url: `${getServerUrl()}/api/shapes/notes`,
      headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
      columnMapper: snakeCamelMapper(),
      // Synced rows skip the collection schema, so parse timestamps here.
      parser: { timestamptz: (value: string) => new Date(value) },
    },
    onInsert: async ({ transaction }) => {
      const results = await Promise.all(
        transaction.mutations.map((m) => api.createNote(createNoteSchema.parse(m.modified))),
      );
      return { txid: results.map((r) => r.txid) };
    },
    onUpdate: async ({ transaction }) => {
      const results = await Promise.all(
        transaction.mutations.map((m) =>
          api.updateNote(String(m.key), updateNoteSchema.parse(m.changes)),
        ),
      );
      return { txid: results.map((r) => r.txid) };
    },
    onDelete: async ({ transaction }) => {
      const results = await Promise.all(
        transaction.mutations.map((m) => api.deleteNote(String(m.key))),
      );
      return { txid: results.map((r) => r.txid) };
    },
  }),
);

export const boardColumnsCollection = createCollection(
  electricCollectionOptions({
    id: 'board-columns',
    schema: boardColumnSchema,
    getKey: (column) => column.id,
    shapeOptions: {
      url: `${getServerUrl()}/api/shapes/board-columns`,
      headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
      columnMapper: snakeCamelMapper(),
    },
    onInsert: async ({ transaction }) => {
      const results = await Promise.all(
        transaction.mutations.map((m) =>
          api.createBoardColumn(createBoardColumnSchema.parse(m.modified)),
        ),
      );
      return { txid: results.map((r) => r.txid) };
    },
    onUpdate: async ({ transaction }) => {
      const results = await Promise.all(
        transaction.mutations.map((m) =>
          api.updateBoardColumn(String(m.key), updateBoardColumnSchema.parse(m.changes)),
        ),
      );
      return { txid: results.map((r) => r.txid) };
    },
    onDelete: async ({ transaction }) => {
      const results = await Promise.all(
        transaction.mutations.map((m) => api.deleteBoardColumn(String(m.key))),
      );
      return { txid: results.map((r) => r.txid) };
    },
  }),
);

/** The signed-in user's Deck columns, unordered. */
export function useBoardColumns() {
  const { data = [] } = useLiveQuery((q) => q.from({ column: boardColumnsCollection }));
  return data;
}

/**
 * What the server found at the links in the user's notes, keyed by normalized URL. Read
 * only: the server adds and fills rows as notes are saved (see `api.refreshLinkPreview`).
 */
export const linkPreviewsCollection = createCollection(
  electricCollectionOptions({
    id: 'link-previews',
    schema: linkPreviewSchema,
    getKey: (preview) => preview.url,
    shapeOptions: {
      url: `${getServerUrl()}/api/shapes/link-previews`,
      headers: { Authorization: () => `Bearer ${getAuthToken() ?? ''}` },
      columnMapper: snakeCamelMapper(),
      parser: { timestamptz: (value: string) => new Date(value) },
    },
  }),
);

// Every card on a page reads previews, so they share one subscription instead of a live
// query each.
let previewsByUrl: ReadonlyMap<string, LinkPreview> = new Map();
const previewListeners = new Set<() => void>();
let previewsSubscribed = false;

function subscribeToPreviews(listener: () => void) {
  previewListeners.add(listener);
  if (previewsSubscribed) return () => previewListeners.delete(listener);
  previewsSubscribed = true;
  // Kept for the session, like the collection's own sync.
  linkPreviewsCollection.subscribeChanges(
    () => {
      previewsByUrl = new Map(
        [...linkPreviewsCollection.values()].map((preview) => [preview.url, preview]),
      );
      for (const notify of previewListeners) notify();
    },
    { includeInitialState: true },
  );
  return () => previewListeners.delete(listener);
}

/** The user's link previews by URL. */
export function useLinkPreviews(): ReadonlyMap<string, LinkPreview> {
  return useSyncExternalStore(subscribeToPreviews, () => previewsByUrl);
}
