import {
  blocksHaveContent,
  DEFAULT_BOARD_STATUS,
  MAX_NOTES_PER_REQUEST,
  mapAttachmentBlocks,
  type Note,
  type NoteColor,
  normalizeSecondaryTags,
  positionBetween,
  positionsBetween,
  sharedNoteAsNote,
  type VaultFile,
} from '@catch/shared';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { copyAttachmentFiles, copySealedBlob } from './attachmentFiles';
import {
  attachmentsCollection,
  notesCollection,
  sharedNotesCollection,
  tagsCollection,
  write,
} from './collections';
import { noteStore, noteTagStore } from './noteStore';
import { assignPrimaryTag, setPrimaryTag } from './tags';
import { getSealedFiles, insertVaultNote, isVaultNote } from './vault';

type NoteChanges = Partial<
  Pick<Note, 'content' | 'color' | 'status' | 'isPinned' | 'isArchived' | 'deletedAt'>
>;

/**
 * Every place taken in one arrangement. Vault notes are arranged among themselves; the
 * others share theirs with the notes someone else shared (ADR 0021).
 */
function* existingPositions(vault = false) {
  for (const note of noteStore.values(vault)) yield note.position;
  if (!vault) for (const shared of sharedNotesCollection.values()) yield shared.position;
}

function firstExistingPosition(vault = false) {
  let first: string | null = null;
  for (const position of existingPositions(vault)) {
    if (first === null || position < first) first = position;
  }
  return first;
}

function lastExistingPosition() {
  let last: string | null = null;
  for (const position of existingPositions()) {
    if (last === null || position > last) last = position;
  }
  return last;
}

/** A position ahead of every note, so new notes land first, as in Keep. */
function firstPosition(vault = false) {
  return positionBetween(null, firstExistingPosition(vault));
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
  primaryTagId?: string | null;
  secondaryTagIds?: readonly string[];
  /** Make it a vault note, sealed before it is stored. The vault must be unlocked. */
  vault?: boolean;
}) {
  const vault = input.vault ?? false;
  const now = new Date();
  const id = input.id ?? uuidv7();
  const linkedTag = input.color
    ? [...tagsCollection.values()].find((tag) => tag.color === input.color)
    : undefined;
  const primaryTagId = input.primaryTagId ?? linkedTag?.id ?? null;
  const secondaryTagIds = normalizeSecondaryTags(
    [...tagsCollection.values()],
    (input.secondaryTagIds ?? []).filter((tagId) => tagId !== primaryTagId),
  );
  const transaction = write(() => {
    noteStore.insert(
      {
        id,
        userId: input.userId,
        content: input.content,
        color: primaryTagId ? 'default' : (input.color ?? 'default'),
        status: input.status ?? null,
        isPinned: false,
        isArchived: false,
        position: firstPosition(vault),
        hiddenLinks: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      vault,
    );
    if (primaryTagId || secondaryTagIds.length)
      noteTagStore.set({ id, userId: input.userId }, (draft) => {
        draft.primaryTagId = primaryTagId;
        draft.secondaryTagIds = secondaryTagIds;
      });
  });
  return { id, transaction };
}

/** The note as this device has it now, local writes included. Not a subscription. */
export function getNote(id: string): Note | undefined {
  const shared = sharedNotesCollection.get(id);
  return noteStore.get(id) ?? (shared && sharedNoteAsNote(shared));
}

/**
 * Someone else's note in the user's gallery (ADR 0021) takes only the changes that are the
 * user's to make: its pin and archive. Nothing here edits it, so its dates stay its owner's.
 */
function updateSharedNote(id: string, changes: NoteChanges) {
  return write(() =>
    sharedNotesCollection.update(id, (draft) => {
      if (changes.isPinned !== undefined) draft.isPinned = changes.isPinned;
      if (changes.isArchived !== undefined) draft.isArchived = changes.isArchived;
    }),
  );
}

export function updateNote(id: string, changes: NoteChanges) {
  if (sharedNotesCollection.has(id)) return updateSharedNote(id, changes);
  return write(() =>
    noteStore.update(id, (draft) => {
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
  return write(() => {
    if (sharedNotesCollection.has(id)) {
      sharedNotesCollection.update(id, (draft) => {
        draft.position = position;
      });
    } else {
      noteStore.update(id, (draft) => {
        draft.position = position;
      });
    }
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
 * Places deck notes at `index` in their destination column, keeping each pin group
 * in the order given, in one synced update. `others` is in displayed order.
 */
export function moveDeckNotes(
  ids: readonly string[],
  status: string,
  others: readonly Note[],
  index: number,
) {
  const positions = new Map<string, string>();
  // Pin groups have independent position orders: a boundary between them need not
  // have ascending keys, so only neighbours in the same group can bound a move.
  for (const isPinned of [true, false]) {
    const group = ids.filter((id) => noteStore.get(id)?.isPinned === isPinned);
    if (!group.length) continue;
    const peers = others.filter((note) => note.isPinned === isPinned);
    const at = others.slice(0, index).filter((note) => note.isPinned === isPinned).length;
    const keys = positionsBetween(...boundsForMove(peers, at), group.length);
    for (const [i, id] of group.entries()) positions.set(id, keys[i]!);
  }
  const now = new Date();
  return write(() =>
    noteStore.update([...ids], (drafts) => {
      for (const draft of drafts) {
        if (draft.status !== status) {
          draft.status = status;
          draft.updatedAt = now;
        }
        draft.position = positions.get(draft.id) ?? draft.position;
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
      noteStore.update(id, (draft) => {
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
  const isPinned = getNote(id)?.isPinned ?? false;
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
    noteStore.update(
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

export const deleteNoteForever = (id: string) => write(() => noteStore.delete(id));

export function trashNote(id: string) {
  const now = new Date();
  const transaction = write(() =>
    noteStore.update(id, (draft) => {
      draft.deletedAt = now;
      draft.updatedAt = now;
    }),
  );
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
    noteStore.update([...ids], (drafts) => {
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
    noteStore.update(
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
    noteStore.update(
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
    noteStore.update(
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
  write(() => noteStore.delete([...ids]));

export function trashNotes(ids: readonly string[]) {
  const now = new Date();
  const transaction = write(() =>
    noteStore.update([...ids], (drafts) => {
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
  // A page shows one kind of note, so the copies are of that kind too.
  const vault = notes.some((note) => isVaultNote(note.id));
  const positions = positionsBetween(null, firstExistingPosition(vault), notes.length);
  const copies = notes.map((note, index) => ({
    ...note,
    id: uuidv7(),
    content: structuredClone(note.content),
    position: positions[index] ?? firstPosition(vault),
    createdAt: now,
    updatedAt: now,
    deletedAt: note.deletedAt ? now : null,
  }));
  // A vault note's files are sealed inside it: each copy holds the same bytes, sealed as
  // they were, under ids of its own.
  const sealedFiles = new Map<string, VaultFile[]>();
  const files = copies.flatMap((copy, index) => {
    const original = notes[index];
    if (!original) return [];
    if (vault) {
      const row = (sourceId: string, id: string) => {
        const source = attachmentsCollection.get(sourceId);
        return source && !source.deletedAt
          ? [
              {
                ...source,
                id,
                noteId: copy.id,
                sourceId,
                status: 'pending' as const,
                createdAt: now,
              },
            ]
          : [];
      };
      const rows: ReturnType<typeof row> = [];
      const kept: VaultFile[] = [];
      const ids = new Map<string, string>();
      for (const file of getSealedFiles(original.id)) {
        const bytes = row(file.id, uuidv7());
        if (!bytes[0]) continue;
        const thumbnail = file.thumbnailId ? row(file.thumbnailId, uuidv7()) : [];
        rows.push(...bytes, ...thumbnail);
        ids.set(file.id, bytes[0].id);
        kept.push({ ...file, id: bytes[0].id, thumbnailId: thumbnail[0]?.id ?? null });
      }
      copy.content = mapAttachmentBlocks(copy.content, ids);
      sealedFiles.set(copy.id, kept);
      return rows;
    }
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
    if (!vault) notesCollection.insert(copies);
    for (const [index, copy] of copies.entries()) {
      const original = notes[index];
      const assignments = original ? noteTagStore.get(original.id) : undefined;
      const tags = assignments && {
        primaryTagId: assignments.primaryTagId,
        secondaryTagIds: [...assignments.secondaryTagIds],
      };
      // A vault note's tags are sealed in with it, so they go in as it does.
      if (vault) insertVaultNote(copy, tags, sealedFiles.get(copy.id));
      else if (tags) noteTagStore.set(copy, (draft) => Object.assign(draft, tags));
    }
  });
  // Queue copies after their notes exist; pending originals reach the server first.
  if (files.length) write(() => attachmentsCollection.insert(files));
  // Cached originals and thumbnails let copies preview before the server is reachable.
  for (const file of files) {
    void (vault ? copySealedBlob : copyAttachmentFiles)(file.sourceId, file.id).catch(() => {});
  }
  toast(plural(notes.length, 'Note copied', 'notes copied'));
  return { ids: copies.map((copy) => copy.id), transaction };
}

/**
 * Deletes a note left without content, as Keep does when an editor closes on an empty
 * note. Returns whether it was discarded.
 */
export function discardIfEmpty(id: string) {
  const note = noteStore.get(id);
  if (
    !note ||
    note.deletedAt ||
    blocksHaveContent(note.content) ||
    [...attachmentsCollection.values()].some((file) => file.noteId === id && !file.deletedAt)
  )
    return false;
  write(() => noteStore.delete(id));
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
