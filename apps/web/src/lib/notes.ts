import { DEFAULT_BOARD_STATUS, type Note, type NoteColor } from '@catch/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { notesCollection } from './collections';

type NoteChanges = Partial<
  Pick<Note, 'content' | 'color' | 'status' | 'isPinned' | 'isArchived' | 'deletedAt'>
>;

/**
 * Note mutations. Each applies optimistically to the synced collection and
 * returns the TanStack DB transaction, whose `isPersisted.promise` settles once
 * the server has the change.
 */
export function createNote(input: {
  userId: string;
  content: Note['content'];
  color?: NoteColor;
  status?: string | null;
}) {
  const now = new Date();
  const id = uuidv7();
  const transaction = notesCollection.insert({
    id,
    userId: input.userId,
    content: input.content,
    color: input.color ?? 'default',
    status: input.status ?? null,
    isPinned: false,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return { id, transaction };
}

export function updateNote(id: string, changes: NoteChanges) {
  return notesCollection.update(id, (draft) => {
    Object.assign(draft, changes);
    draft.updatedAt = new Date();
  });
}

export const setNoteColor = (id: string, color: NoteColor) => updateNote(id, { color });

export const setNotePinned = (id: string, isPinned: boolean) => updateNote(id, { isPinned });

export const setNoteArchived = (id: string, isArchived: boolean) =>
  // Archiving unpins, as in Keep.
  updateNote(id, isArchived ? { isArchived, isPinned: false } : { isArchived });

export const moveNoteToDeck = (id: string) => updateNote(id, { status: DEFAULT_BOARD_STATUS });

export const sendNoteToGallery = (id: string) => updateNote(id, { status: null });

export const restoreNote = (id: string) => updateNote(id, { deletedAt: null });

export const deleteNoteForever = (id: string) => notesCollection.delete(id);

export function trashNote(id: string) {
  const transaction = updateNote(id, { deletedAt: new Date() });
  toast('Note moved to trash', {
    action: { label: 'Undo', onClick: () => restoreNote(id) },
  });
  return transaction;
}
