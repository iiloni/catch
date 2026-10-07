import type { Note, NoteTags } from '@catch/shared';
import { notesCollection, noteTagsCollection } from './collections';
import {
  changeVaultNote,
  changeVaultNoteTags,
  getVaultNote,
  getVaultNoteTags,
  insertVaultNote,
  isVaultNote,
  removeVaultNote,
  vaultNotes,
} from './vault';

/**
 * Notes of both kinds behind one set of calls. An ordinary note is a row in the notes
 * collection; a vault note is sealed before it is stored (ADR 0020). The note actions change
 * notes through here, inside `write()`, and never need to know which kind they have.
 *
 * A call takes notes of one kind: a page shows the vault's notes or the others, never both.
 */

const asList = (ids: string | readonly string[]) => (typeof ids === 'string' ? [ids] : [...ids]);

/** Changes one note, or several at once, as the notes collection's own `update` does. */
function update(id: string, change: (draft: Note) => void): void;
function update(ids: readonly string[], change: (drafts: Note[]) => void): void;
function update(
  ids: string | readonly string[],
  change: ((draft: Note) => void) | ((drafts: Note[]) => void),
) {
  if (typeof ids === 'string') {
    const one = change as (draft: Note) => void;
    if (isVaultNote(ids)) changeVaultNote(ids, one);
    else notesCollection.update(ids, (draft) => one(draft as Note));
    return;
  }
  const many = change as (drafts: Note[]) => void;
  const sealed = ids.filter(isVaultNote);
  if (sealed.length > 0) {
    const drafts = sealed.flatMap((id) => {
      const note = getVaultNote(id);
      return note ? [{ ...note }] : [];
    });
    many(drafts);
    for (const draft of drafts) changeVaultNote(draft.id, (note) => Object.assign(note, draft));
  }
  const plain = ids.filter((id) => !isVaultNote(id));
  if (plain.length > 0) notesCollection.update(plain, (drafts) => many(drafts as Note[]));
}

export const noteStore = {
  get: (id: string): Note | undefined => getVaultNote(id) ?? notesCollection.get(id),
  has: (id: string) => isVaultNote(id) || notesCollection.has(id),
  /** Every note of one kind: the vault's, or all the others. */
  values: (vault: boolean): Iterable<Note> => (vault ? vaultNotes.get() : notesCollection.values()),
  /** Adds notes to the vault or to the ordinary notes. */
  insert(notes: Note | Note[], vault: boolean) {
    if (!vault) notesCollection.insert(notes);
    else for (const note of Array.isArray(notes) ? notes : [notes]) insertVaultNote(note);
  },
  update,
  delete(ids: string | readonly string[]) {
    const list = asList(ids);
    const sealed = list.filter(isVaultNote);
    for (const id of sealed) removeVaultNote(id);
    const plain = list.filter((id) => !sealed.includes(id));
    if (plain.length > 0) notesCollection.delete(plain);
  },
};

/** A note's tags, wherever they are kept: a row of their own, or sealed inside a vault note. */
export const noteTagStore = {
  get: (id: string): NoteTags | undefined =>
    isVaultNote(id) ? getVaultNoteTags(id) : noteTagsCollection.get(id),
  /** Changes a note's tags, giving it a row for them if it has none. */
  set(
    note: Pick<Note, 'id' | 'userId'>,
    change: (draft: Pick<NoteTags, 'primaryTagId' | 'secondaryTagIds'>) => void,
  ) {
    if (isVaultNote(note.id)) changeVaultNoteTags(note.id, change);
    else if (noteTagsCollection.has(note.id)) noteTagsCollection.update(note.id, change);
    else {
      const row: NoteTags = {
        id: note.id,
        userId: note.userId,
        primaryTagId: null,
        secondaryTagIds: [],
      };
      change(row);
      noteTagsCollection.insert(row);
    }
  },
};
