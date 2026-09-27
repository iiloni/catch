import { createNoteSchema, noteSchema, updateNoteSchema } from '@catch/shared';
import { snakeCamelMapper } from '@electric-sql/client';
import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import { createCollection } from '@tanstack/react-db';
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
