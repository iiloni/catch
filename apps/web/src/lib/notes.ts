import {
  blocksHaveContent,
  DEFAULT_BOARD_STATUS,
  type Note,
  type NoteColor,
  positionBetween,
} from '@catch/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { notesCollection } from './collections';

type NoteChanges = Partial<
  Pick<Note, 'content' | 'color' | 'status' | 'isPinned' | 'isArchived' | 'deletedAt'>
>;

/** A position ahead of every note, so new notes land first, as in Keep. */
function firstPosition() {
  let first: string | null = null;
  for (const note of notesCollection.values()) {
    if (first === null || note.position < first) first = note.position;
  }
  return positionBetween(null, first);
}

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
    position: firstPosition(),
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

/**
 * Moves a note to `index` among `others`, the notes it is shown with, in order and
 * without itself. Unlike an edit, this leaves `updatedAt` alone.
 */
export function moveNote(id: string, others: readonly Note[], index: number) {
  const before = others[index - 1]?.position ?? null;
  // Skip neighbours that share the position before (two devices can hand out the same one).
  const after =
    others.slice(index).find((note) => before === null || note.position > before)?.position ?? null;
  const position = positionBetween(before, after);
  return notesCollection.update(id, (draft) => {
    draft.position = position;
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
  toast('Moved to trash', {
    action: { label: 'Undo', onClick: () => restoreNote(id) },
  });
  return transaction;
}

/**
 * Deletes a note left without content, as Keep does when an editor closes on an empty
 * note. Returns whether it was discarded.
 */
export function discardIfEmpty(id: string) {
  const note = notesCollection.get(id);
  if (!note || note.deletedAt || blocksHaveContent(note.content)) return false;
  notesCollection.delete(id);
  toast('Empty note discarded');
  return true;
}
