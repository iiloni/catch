import { type Note, shareLink } from '@catch/shared';
import { toast } from 'sonner';
import { api } from './api';
import { getSignedInUser } from './auth';
import {
  awaitSharedNote,
  noteSharesCollection,
  sharedNotesCollection,
  useSharedNotes,
  write,
} from './collections';
import { getServerUrl } from './serverUrl';

/**
 * Whether a note is someone else's, added to this gallery from their share link (ADR 0021).
 * Such a note is read here, not edited: only its pin, archive and place are the user's.
 */
export function isSharedNote(note: Pick<Note, 'userId'>) {
  const user = getSignedInUser();
  return user !== null && note.userId !== user.id;
}

/** 32 random bytes in base64url, as `shareTokenSchema` takes them. */
export function newShareToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** The link a note is shared at, for its token. */
export const noteShareLink = (token: string) => shareLink(getServerUrl(), token);

export async function acceptSharedNote(token: string) {
  const { noteId, txid } = await api.acceptShare(token);
  await awaitSharedNote(noteId, txid);
  return noteId;
}

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

/**
 * Takes someone else's note out of the user's gallery. Undo adds it again by its link, where
 * it was, unless its owner stopped sharing it meanwhile.
 */
export function removeSharedNote(noteId: string) {
  const shared = sharedNotesCollection.get(noteId);
  if (!shared) return;
  write(() => sharedNotesCollection.delete(noteId));
  toast('Removed from your notes', {
    action: {
      label: 'Undo',
      onClick: () => {
        if (!sharedNotesCollection.has(noteId))
          write(() => sharedNotesCollection.insert({ ...shared }));
      },
    },
  });
}

/** Who shared a note in the user's gallery, or undefined for a note of their own. */
export function useSharedNoteOwner(noteId: string) {
  return useSharedNotes().byId.get(noteId)?.ownerName;
}
