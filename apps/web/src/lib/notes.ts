import {
  blocksHaveContent,
  DEFAULT_BOARD_STATUS,
  MAX_NOTES_PER_REQUEST,
  mapAttachmentBlocks,
  type Note,
  type NoteColor,
  positionBetween,
  positionsBetween,
} from '@catch/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { copyAttachmentFiles } from './attachmentFiles';
import {
  attachmentsCollection,
  notesCollection,
  noteTagsCollection,
  tagsCollection,
  write,
} from './collections';

import { assignPrimaryTag, setPrimaryTag } from './tags';

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

function lastExistingPosition() {
  let last: string | null = null;
  for (const note of notesCollection.values()) {
    if (last === null || note.position > last) last = note.position;
  }
  return last;
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
  id?: string;
  userId: string;
  content: Note['content'];
  color?: NoteColor;
  status?: string | null;
}) {
  const now = new Date();
  const id = input.id ?? uuidv7();
  const linkedTag = input.color
    ? [...tagsCollection.values()].find((tag) => tag.color === input.color)
    : undefined;
  const transaction = write(() => {
    notesCollection.insert({
      id,
      userId: input.userId,
      content: input.content,
      color: linkedTag ? 'default' : (input.color ?? 'default'),
      status: input.status ?? null,
      isPinned: false,
      isArchived: false,
      position: firstPosition(),
      hiddenLinks: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    if (linkedTag) assignPrimaryTag(id, linkedTag.id);
  });
  return { id, transaction };
}

/** The note as this device has it now, local writes included. Not a subscription. */
export const getNote = (id: string): Note | undefined => notesCollection.get(id);

export function updateNote(id: string, changes: NoteChanges) {
  return write(() =>
    notesCollection.update(id, (draft) => {
      Object.assign(draft, changes);
      draft.updatedAt = new Date();
    }),
  );
}

/**
 * Moves a note to `index` among `others`, the notes it is shown with, in order and
 * without itself. Unlike an edit, this leaves `updatedAt` alone.
 */
export function moveNote(id: string, others: readonly Note[], index: number) {
  const position = positionForMove(others, index);
  return write(() =>
    notesCollection.update(id, (draft) => {
      draft.position = position;
    }),
  );
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
  return write(() =>
    notesCollection.update([...ids], (drafts) => {
      for (const draft of drafts) {
        if (draft.status !== status) {
          draft.status = status;
          draft.updatedAt = now;
        }
        draft.position = positions[order.get(draft.id) ?? -1] ?? draft.position;
      }
    }),
  );
}

/**
 * Removes a link's preview from a note, leaving the link in its text. Like rearranging, this
 * is not an edit, so it leaves `updatedAt` alone.
 */
export function hideLinkPreview(id: string, url: string) {
  const setHidden = (hidden: boolean) =>
    write(() =>
      notesCollection.update(id, (draft) => {
        const others = draft.hiddenLinks.filter((link) => link !== url);
        draft.hiddenLinks = hidden ? [...others, url] : others;
      }),
    );
  const transaction = setHidden(true);
  toast('Preview removed', { action: { label: 'Undo', onClick: () => setHidden(false) } });
  return transaction;
}

export function setNoteColor(id: string, color: NoteColor) {
  const root = [...tagsCollection.values()].find((tag) => tag.color === color);
  return setPrimaryTag(id, root?.id ?? null, root ? 'default' : color);
}

export const setNotePinned = (id: string, isPinned: boolean) => updateNote(id, { isPinned });

export function setNoteArchived(id: string, isArchived: boolean) {
  const isPinned = notesCollection.get(id)?.isPinned ?? false;
  // Archiving unpins, as in Keep.
  const transaction = updateNote(id, isArchived ? { isArchived, isPinned: false } : { isArchived });
  if (isArchived) {
    toast('Note archived', {
      action: { label: 'Undo', onClick: () => updateNote(id, { isArchived: false, isPinned }) },
    });
  }
  return transaction;
}

export const moveNoteToDeck = (id: string, status = DEFAULT_BOARD_STATUS) =>
  updateNote(id, { status });

export const sendNoteToGallery = (id: string) => updateNote(id, { status: null });

/** Takes deck notes out of the deck. Undo puts each back in its column. */
export function sendNotesToGallery(notes: readonly Note[]) {
  const now = new Date();
  const transaction = write(() =>
    notesCollection.update(
      notes.map((note) => note.id),
      (drafts) => {
        for (const draft of drafts) {
          draft.status = null;
          draft.updatedAt = now;
        }
      },
    ),
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

export const deleteNoteForever = (id: string) => write(() => notesCollection.delete(id));

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
  const root = [...tagsCollection.values()].find((tag) => tag.color === color);
  return write(() => {
    notesCollection.update([...ids], (drafts) => {
      for (const draft of drafts) {
        draft.color = root ? 'default' : color;
        draft.updatedAt = now;
      }
    });
    for (const id of ids) assignPrimaryTag(id, root?.id ?? null);
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
  const transaction = write(() =>
    notesCollection.update(
      notes.map((note) => note.id),
      (drafts) => {
        for (const draft of drafts) {
          draft.isArchived = true;
          draft.isPinned = false;
          draft.deletedAt = null;
          draft.updatedAt = now;
        }
      },
    ),
  );
  toast(plural(notes.length, 'Note archived', 'notes archived'), {
    action: { label: 'Undo', onClick: undoFor(notes) },
  });
  return transaction;
}

export function unarchiveNotes(notes: readonly Note[]) {
  const now = new Date();
  const transaction = write(() =>
    notesCollection.update(
      notes.map((note) => note.id),
      (drafts) => {
        for (const draft of drafts) {
          draft.isArchived = false;
          draft.updatedAt = now;
        }
      },
    ),
  );
  toast(plural(notes.length, 'Note unarchived', 'notes unarchived'), {
    action: { label: 'Undo', onClick: undoFor(notes) },
  });
  return transaction;
}

/** Takes notes out of the trash, back to the gallery or archive they were in. */
export function restoreNotes(notes: readonly Note[]) {
  const now = new Date();
  const transaction = write(() =>
    notesCollection.update(
      notes.map((note) => note.id),
      (drafts) => {
        for (const draft of drafts) {
          draft.deletedAt = null;
          draft.updatedAt = now;
        }
      },
    ),
  );
  toast(plural(notes.length, 'Note restored', 'notes restored'), {
    action: { label: 'Undo', onClick: undoFor(notes) },
  });
  return transaction;
}

export const deleteNotesForever = (ids: readonly string[]) =>
  write(() => notesCollection.delete([...ids]));

export function trashNotes(ids: readonly string[]) {
  const now = new Date();
  const transaction = write(() =>
    notesCollection.update([...ids], (drafts) => {
      for (const draft of drafts) {
        draft.deletedAt = now;
        draft.updatedAt = now;
      }
    }),
  );
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
  const files = copies.flatMap((copy, index) => {
    const original = notes[index];
    if (!original) return [];
    const attachments = [...attachmentsCollection.values()].filter(
      (file) => file.noteId === original.id && !file.deletedAt,
    );
    const ids = new Map(attachments.map((file) => [file.id, uuidv7()]));
    copy.content = mapAttachmentBlocks(copy.content, ids);
    return attachments.map((file) => ({
      ...file,
      id: ids.get(file.id)!,
      noteId: copy.id,
      sourceId: file.id,
      status: 'pending' as const,
      createdAt: now,
    }));
  });
  const transaction = write(() => {
    notesCollection.insert(copies);
    for (const [index, copy] of copies.entries()) {
      const original = notes[index];
      const assignments = original ? noteTagsCollection.get(original.id) : undefined;
      if (assignments)
        noteTagsCollection.insert({
          ...assignments,
          id: copy.id,
          secondaryTagIds: [...assignments.secondaryTagIds],
        });
    }
  });
  // Queue copies after their notes exist; pending originals reach the server first.
  if (files.length) write(() => attachmentsCollection.insert(files));
  // Cached originals and thumbnails let copies preview before the server is reachable.
  for (const file of files) void copyAttachmentFiles(file.sourceId, file.id).catch(() => {});
  toast(plural(notes.length, 'Note copied', 'notes copied'));
  return { ids: copies.map((copy) => copy.id), transaction };
}

/**
 * Deletes a note left without content, as Keep does when an editor closes on an empty
 * note. Returns whether it was discarded.
 */
export function discardIfEmpty(id: string) {
  const note = notesCollection.get(id);
  if (
    !note ||
    note.deletedAt ||
    blocksHaveContent(note.content) ||
    [...attachmentsCollection.values()].some((file) => file.noteId === id && !file.deletedAt)
  )
    return false;
  write(() => notesCollection.delete(id));
  toast('Empty note discarded');
  return true;
}

/** A note brought in from another app, with the id and dates it will keep here. */
export type ImportedNote = Pick<
  Note,
  'id' | 'content' | 'color' | 'isPinned' | 'isArchived' | 'createdAt' | 'updatedAt'
>;

/**
 * Whether a note is here, in any place. Importers give notes ids that stay the same across
 * imports, so this spots the notes an earlier import of the same export added.
 */
export const hasNote = (id: string) => notesCollection.has(id);

/** One write of an import: its outbox transaction, and how many notes it holds. */
export type ImportBatch = { id: string; count: number; persisted: Promise<unknown> };

// Fewer notes than a request can take, so an import's progress moves in visible steps. The
// outbox sends one write at a time, each waiting for the server to sync it back.
const IMPORT_BATCH = Math.min(50, MAX_NOTES_PER_REQUEST);

/**
 * Adds imported notes after every other note, in the order given, leaving out any already
 * here. They show on this device at once; each batch is its own write, so one the server
 * refuses rolls back alone. Each batch's `persisted` settles once the server has it, which
 * offline can be much later.
 */
export function importNotes(userId: string, notes: readonly ImportedNote[]): ImportBatch[] {
  const fresh = notes.filter((note) => !hasNote(note.id));
  const positions = positionsBetween(lastExistingPosition(), null, fresh.length);
  const batches: ImportBatch[] = [];
  for (let start = 0; start < fresh.length; start += IMPORT_BATCH) {
    const batch = fresh.slice(start, start + IMPORT_BATCH).map((note, index) => ({
      ...note,
      userId,
      status: null,
      // Archived notes are never pinned here (see `setNoteArchived`).
      isPinned: note.isPinned && !note.isArchived,
      position: positions[start + index] ?? firstPosition(),
      hiddenLinks: [],
      deletedAt: null,
    }));
    const transaction = write(() => notesCollection.insert(batch));
    batches.push({
      id: transaction.id,
      count: batch.length,
      persisted: transaction.isPersisted.promise,
    });
  }
  return batches;
}
