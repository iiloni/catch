import {
  type Note,
  type NoteColor,
  type NoteTags,
  normalizeSecondaryTags,
  type Tag,
  tagColor,
  tagSubtreeIds,
  type UpdateTag,
} from '@catch/shared';
import { uuidv7 } from 'uuidv7';
import {
  noteTagsCollection,
  tagsCollection,
  useNoteTagAssignments,
  useTags,
  write,
} from './collections';
import { noteStore, noteTagStore } from './noteStore';
import { getVaultNoteTags, vaultNotes } from './vault';

/**
 * Every note's tags, with who owns the note: the synced assignments, and those sealed inside
 * the notes of an unlocked vault. A locked vault's notes keep what they had; a tag they
 * name that has since gone is ignored when they are next opened.
 */
function allAssignments(): NoteTags[] {
  return [
    ...noteTagsCollection.values(),
    ...vaultNotes.get().flatMap((note) => getVaultNoteTags(note.id) ?? []),
  ];
}

export function createTag(userId: string, input: Omit<Tag, 'id' | 'userId'>) {
  const id = uuidv7();
  const transaction = write(() => {
    tagsCollection.insert({ id, userId, ...input });
    if (input.color) tagPlainColorNotes(id, input.color);
  });
  return { id, transaction };
}
export function updateTag(id: string, changes: UpdateTag) {
  const previousColor = tagsCollection.get(id)?.color;
  return write(() => {
    tagsCollection.update(id, (draft) => {
      Object.assign(draft, changes);
    });
    if (changes.color && changes.color !== previousColor) tagPlainColorNotes(id, changes.color);
    if (changes.parentId !== undefined) {
      const tags = [...tagsCollection.values()];
      for (const assignment of allAssignments()) {
        const normalized = normalizeSecondaryTags(tags, assignment.secondaryTagIds);
        if (normalized.length !== assignment.secondaryTagIds.length)
          noteTagStore.set(assignment, (draft) => {
            draft.secondaryTagIds = normalized;
          });
      }
    }
  });
}

function tagPlainColorNotes(tagId: string, color: NonNullable<Tag['color']>) {
  for (const note of [...noteStore.values(false), ...noteStore.values(true)]) {
    if (note.color !== color || noteTagStore.get(note.id)?.primaryTagId) continue;
    noteStore.update(note.id, (draft) => {
      draft.color = 'default';
    });
    assignPrimaryTag(note.id, tagId);
  }
}
export function deleteTag(id: string) {
  const removed = tagSubtreeIds([...tagsCollection.values()], id);
  return write(() => {
    for (const assignment of allAssignments()) {
      if (
        !removed.has(assignment.primaryTagId ?? '') &&
        !assignment.secondaryTagIds.some((tagId) => removed.has(tagId))
      )
        continue;
      noteTagStore.set(assignment, (draft) => {
        if (removed.has(draft.primaryTagId ?? '')) draft.primaryTagId = null;
        draft.secondaryTagIds = draft.secondaryTagIds.filter((tagId) => !removed.has(tagId));
      });
    }
    // Delete children before parents; the server's subtree delete makes retries harmless.
    tagsCollection.delete([...removed].filter((tagId) => tagsCollection.has(tagId)).reverse());
  });
}

/** Called inside write, so a color and its primary assignment are one optimistic edit. */
export function assignPrimaryTag(id: string, primaryTagId: string | null) {
  const note = noteStore.get(id);
  if (!note) return;
  // A note with no tags yet needs no row to say it has no primary.
  if (!noteTagStore.get(id) && !primaryTagId) return;
  noteTagStore.set(note, (draft) => {
    draft.primaryTagId = primaryTagId;
    draft.secondaryTagIds = normalizeSecondaryTags(
      [...tagsCollection.values()],
      draft.secondaryTagIds.filter((tagId) => tagId !== primaryTagId),
    );
  });
}
export function setPrimaryTag(
  id: string,
  primaryTagId: string | null,
  color: NoteColor = 'default',
) {
  return write(() => {
    noteStore.update(id, (draft) => {
      draft.color = color;
      draft.updatedAt = new Date();
    });
    assignPrimaryTag(id, primaryTagId);
  });
}
export function setSecondaryTag(id: string, tagId: string, selected: boolean) {
  const note = noteStore.get(id);
  if (!note) return;
  return write(() => {
    if (noteTagStore.get(id)?.primaryTagId === tagId) return;
    noteTagStore.set(note, (draft) => {
      const others = draft.secondaryTagIds.filter((value) => value !== tagId);
      draft.secondaryTagIds = normalizeSecondaryTags(
        [...tagsCollection.values()],
        selected ? [...others, tagId] : others,
      );
    });
  });
}
export function useNoteColor(note: Pick<Note, 'id' | 'color'>): NoteColor {
  const tags = useTags();
  const assignment = useNoteTagAssignments().get(note.id);
  return assignment?.primaryTagId ? tagColor(tags, assignment.primaryTagId) : note.color;
}

export function setPrimaryTags(ids: readonly string[], primaryTagId: string) {
  return write(() => {
    noteStore.update([...ids], (drafts) => {
      for (const draft of drafts) {
        draft.color = 'default';
        draft.updatedAt = new Date();
      }
    });
    for (const id of ids) assignPrimaryTag(id, primaryTagId);
  });
}

/** Unresolved assignment IDs must not create empty tag sections during partial sync. */
export function useResolvedNoteTags(noteId: string): Tag[] {
  const tags = useTags();
  const assignment = useNoteTagAssignments().get(noteId);
  const ids = new Set([
    ...(assignment?.primaryTagId ? [assignment.primaryTagId] : []),
    ...(assignment?.secondaryTagIds ?? []),
  ]);
  return tags.filter((tag) => ids.has(tag.id));
}
