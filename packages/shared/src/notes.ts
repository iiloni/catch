import { z } from 'zod';
import { NOTE_COLORS } from './colors';

export const noteColorSchema = z.enum(NOTE_COLORS);

/**
 * Notes with a status appear on the board; notes without one live in the gallery.
 */
export const noteStatusSchema = z.string().min(1).max(64).nullable();

/**
 * BlockNote document JSON. It is the source of truth for note content; plain text
 * is derived from it on the server for search and export.
 */
export const noteContentSchema = z.array(z.record(z.string(), z.unknown()));

export const noteSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  userId: z.string(),
  content: noteContentSchema,
  color: noteColorSchema,
  status: noteStatusSchema,
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  deletedAt: z.coerce.date().nullable(),
});

export type Note = z.infer<typeof noteSchema>;

/** Clients generate the UUIDv7 so notes can be created offline. */
export const createNoteSchema = noteSchema
  .pick({ id: true, content: true, color: true, status: true, isPinned: true })
  .partial({ color: true, status: true, isPinned: true });

export type CreateNote = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = noteSchema
  .pick({
    content: true,
    color: true,
    status: true,
    isPinned: true,
    isArchived: true,
    deletedAt: true,
  })
  .partial();

export type UpdateNote = z.infer<typeof updateNoteSchema>;
