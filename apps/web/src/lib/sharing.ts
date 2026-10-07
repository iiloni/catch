import { type Note, newShareToken, shareLink } from '@catch/shared';
import { toast } from 'sonner';
import { getSignedInUser } from './auth';
import { noteSharesCollection, sharedNotesCollection, useSharedNotes, write } from './collections';
import { getServerUrl } from './serverUrl';

/**
 * Whether a note is someone else's, added to this gallery from their share link (ADR 0020).
 * Such a note is read here, not edited: only its pin, archive and place are the user's.
 */
export function isSharedNote(note: Pick<Note, 'userId'>) {
  const user = getSignedInUser();
  return user !== null && note.userId !== user.id;
}

/** The link a note is shared at, for its token. */
export const noteShareLink = (token: string) => shareLink(getServerUrl(), token);

/**
 * Shares a note, giving back its link. The device makes the token, so this works offline;
 * the link starts working once the write reaches the server.
 */
export function shareNote(note: Pick<Note, 'id' | 'userId'>) {
  const existing = noteSharesCollection.get(note.id);
  if (existing) return noteShareLink(existing.token);
  const token = newShareToken();
  write(() =>
    noteSharesCollection.insert({
      noteId: note.id,
      userId: note.userId,
      token,
      createdAt: new Date(),
    }),
  );
  return noteShareLink(token);
}

/** Ends a note's sharing: its link stops working and it leaves the galleries it was added to. */
export function stopSharingNote(noteId: string) {
  if (!noteSharesCollection.has(noteId)) return;
  write(() => noteSharesCollection.delete(noteId));
  toast('Sharing stopped');
}

/** Takes someone else's note out of the user's gallery. Its link adds it again. */
export function removeSharedNote(noteId: string) {
  if (!sharedNotesCollection.has(noteId)) return;
  write(() => sharedNotesCollection.delete(noteId));
  toast('Removed from your notes');
}

/** Who shared a note in the user's gallery, or undefined for a note of their own. */
export function useSharedNoteOwner(noteId: string) {
  return useSharedNotes().byId.get(noteId)?.ownerName;
}
