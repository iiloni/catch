import {
  blocksHaveContent,
  DEFAULT_BOARD_STATUS,
  type Note,
  type NoteColor,
  positionBetween,
  positionsBetween,
} from '@catch/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { notesCollection } from './collections';

type NoteChanges = Partial<
  Pick<Note, 'content' | 'color' | 'status' | 'isPinned' | 'isArchived' | 'deletedAt'>
>;

function firstExistingPosition() {
  let first: string | null = null;
  for (const note of notesCollection.values()) {
    if (first === null || note.position < first) first = note.position;
  }
  return first;
}

/** A position ahead of every note, so new notes land first, as in Keep. */
function firstPosition() {
  return positionBetween(null, firstExistingPosition());
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
    hiddenLinks: [],
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
  const position = positionForMove(others, index);
  return notesCollection.update(id, (draft) => {
    draft.position = position;
  });
}

/** The positions a note moved to `index` among `others` must fall between. */
function boundsForMove(others: readonly Note[], index: number): [string | null, string | null] {
  const before = others[index - 1]?.position ?? null;
  // Skip neighbours that share the position before (two devices can hand out the same one).
  const after =
    others.slice(index).find((note) => before === null || note.position > before)?.position ?? null;
  return [before, after];
}

function positionForMove(others: readonly Note[], index: number) {
  return positionBetween(...boundsForMove(others, index));
}

/**
 * Places deck notes, in the order given, together at `index` among their destination
 * column's other notes, in one synced update.
 */
export function moveDeckNotes(
  ids: readonly string[],
  status: string,
  others: readonly Note[],
  index: number,
) {
  const positions = positionsBetween(...boundsForMove(others, index), ids.length);
  const order = new Map(ids.map((id, i) => [id, i]));
  const now = new Date();
  return notesCollection.update([...ids], (drafts) => {
    for (const draft of drafts) {
      if (draft.status !== status) {
        draft.status = status;
        draft.updatedAt = now;
      }
      draft.position = positions[order.get(draft.id) ?? -1] ?? draft.position;
    }
  });
}

/**
 * Removes a link's preview from a note, leaving the link in its text. Like rearranging, this
 * is not an edit, so it leaves `updatedAt` alone.
 */
export function hideLinkPreview(id: string, url: string) {
  const setHidden = (hidden: boolean) =>
    notesCollection.update(id, (draft) => {
      const others = draft.hiddenLinks.filter((link) => link !== url);
      draft.hiddenLinks = hidden ? [...others, url] : others;
    });
  const transaction = setHidden(true);
  toast('Preview removed', { action: { label: 'Undo', onClick: () => setHidden(false) } });
  return transaction;
}

export const setNoteColor = (id: string, color: NoteColor) => updateNote(id, { color });

export const setNotePinned = (id: string, isPinned: boolean) => updateNote(id, { isPinned });

export const setNoteArchived = (id: string, isArchived: boolean) =>
  // Archiving unpins, as in Keep.
  updateNote(id, isArchived ? { isArchived, isPinned: false } : { isArchived });

export const moveNoteToDeck = (id: string, status = DEFAULT_BOARD_STATUS) =>
  updateNote(id, { status });

export const sendNoteToGallery = (id: string) => updateNote(id, { status: null });

/** Takes deck notes out of the deck. Undo puts each back in its column. */
export function sendNotesToGallery(notes: readonly Note[]) {
  const now = new Date();
  const transaction = notesCollection.update(
    notes.map((note) => note.id),
    (drafts) => {
      for (const draft of drafts) {
        draft.status = null;
        draft.updatedAt = now;
      }
    },
  );
  toast(plural(notes.length, 'Note sent to gallery', 'notes sent to gallery'), {
    action: {
      label: 'Undo',
      onClick: () => {
        for (const note of notes) updateNote(note.id, { status: note.status });
      },
    },
  });
  return transaction;
}

export const restoreNote = (id: string) => updateNote(id, { deletedAt: null });

export const deleteNoteForever = (id: string) => notesCollection.delete(id);

export function trashNote(id: string) {
  const transaction = updateNote(id, { deletedAt: new Date() });
  toast('Moved to trash', {
    action: { label: 'Undo', onClick: () => restoreNote(id) },
  });
  return transaction;
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? one : `${count} ${many}`;

/** Changes the color of several notes in one transaction. */
export function setNotesColor(ids: readonly string[], color: NoteColor) {
  const now = new Date();
  return notesCollection.update([...ids], (drafts) => {
    for (const draft of drafts) {
      draft.color = color;
      draft.updatedAt = now;
    }
  });
}

/** Puts notes back as they were: in place, pinned or not. */
function undoFor(notes: readonly Note[]) {
  return () => {
    for (const note of notes) {
      updateNote(note.id, {
        isArchived: note.isArchived,
        isPinned: note.isPinned,
        deletedAt: note.deletedAt,
      });
    }
  };
}

/**
 * Archives several notes, taking any out of the trash. Undo puts them back where they
 * were, with the pins that archiving removed.
 */
export function archiveNotes(notes: readonly Note[]) {
  const now = new Date();
  const transaction = notesCollection.update(
    notes.map((note) => note.id),
    (drafts) => {
      for (const draft of drafts) {
        draft.isArchived = true;
        draft.isPinned = false;
        draft.deletedAt = null;
        draft.updatedAt = now;
      }
    },
  );
  toast(plural(notes.length, 'Note archived', 'notes archived'), {
    action: { label: 'Undo', onClick: undoFor(notes) },
  });
  return transaction;
}

export function unarchiveNotes(notes: readonly Note[]) {
  const now = new Date();
  const transaction = notesCollection.update(
    notes.map((note) => note.id),
    (drafts) => {
      for (const draft of drafts) {
        draft.isArchived = false;
        draft.updatedAt = now;
      }
    },
  );
  toast(plural(notes.length, 'Note unarchived', 'notes unarchived'), {
    action: { label: 'Undo', onClick: undoFor(notes) },
  });
  return transaction;
}

/** Takes notes out of the trash, back to the gallery or archive they were in. */
export function restoreNotes(notes: readonly Note[]) {
  const now = new Date();
  const transaction = notesCollection.update(
    notes.map((note) => note.id),
    (drafts) => {
      for (const draft of drafts) {
        draft.deletedAt = null;
        draft.updatedAt = now;
      }
    },
  );
  toast(plural(notes.length, 'Note restored', 'notes restored'), {
    action: { label: 'Undo', onClick: undoFor(notes) },
  });
  return transaction;
}

export const deleteNotesForever = (ids: readonly string[]) => notesCollection.delete([...ids]);

export function trashNotes(ids: readonly string[]) {
  const now = new Date();
  const transaction = notesCollection.update([...ids], (drafts) => {
    for (const draft of drafts) {
      draft.deletedAt = now;
      draft.updatedAt = now;
    }
  });
  toast(plural(ids.length, 'Moved to trash', 'notes moved to trash'), {
    action: {
      label: 'Undo',
      onClick: () => {
        for (const id of ids) restoreNote(id);
      },
    },
  });
  return transaction;
}

/**
 * Copies notes, in the order given, ahead of every other note. A copy keeps the original's
 * content, color, pin and place (gallery, deck, archive or trash), but is a new note with
 * its own dates.
 */
export function duplicateNotes(notes: readonly Note[]) {
  const now = new Date();
  const positions = positionsBetween(null, firstExistingPosition(), notes.length);
  const copies = notes.map((note, index) => ({
    ...note,
    id: uuidv7(),
    content: structuredClone(note.content),
    position: positions[index] ?? firstPosition(),
    createdAt: now,
    updatedAt: now,
    deletedAt: note.deletedAt ? now : null,
  }));
  const transaction = notesCollection.insert(copies);
  toast(plural(notes.length, 'Note copied', 'notes copied'));
  return { ids: copies.map((copy) => copy.id), transaction };
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
