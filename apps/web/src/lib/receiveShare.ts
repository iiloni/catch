import { importAttachment } from './attachments';
import { getSignedInUser } from './auth';
import { loadShareCollections, waitForQueuedWrite, waitForWriteStored } from './collections';
import { createNote, hasNote } from './notes';
import { sharedNoteContent } from './shareContent';
import { getIncomingShare, saveIncomingShare } from './shareInbox';

const active = new Map<string, Promise<string>>();

export function receiveShare(id: string): Promise<string> {
  const previous = active.get(id);
  if (previous) return previous;
  const run = () => consume(id);
  // A POST can launch a second window. Only one window may consume a share at a time.
  const promise = navigator.locks ? navigator.locks.request(`catch-share-${id}`, run) : run();
  active.set(id, promise);
  void promise.finally(() => active.delete(id)).catch(() => {});
  return promise;
}

async function consume(id: string) {
  const user = getSignedInUser();
  if (!user) throw new Error('Sign in to save the shared content.');
  const share = await getIncomingShare(id);
  if (!share)
    throw new Error('This share is no longer available. Share it from the other app again.');
  if (share.userId && share.userId !== user.id)
    throw new Error(
      'This share belongs to another account. Sign in to that account to finish saving it.',
    );
  if (share.complete) return share.id;
  share.userId = user.id;
  await saveIncomingShare(share);
  await loadShareCollections();
  if (!hasNote(share.id)) {
    const { transaction } = createNote({
      id: share.id,
      userId: user.id,
      content: sharedNoteContent(share),
    });
    await waitForWriteStored(transaction);
  }
  for (const file of share.files) {
    const value = new File([file.blob], file.name, { type: file.blob.type });
    const batch = await importAttachment(
      {
        id: file.id,
        noteId: share.id,
        createdAt: new Date(),
        read: async () => value,
      },
      value,
      new AbortController().signal,
    );
    // importAttachment uses the same durable byte store and replay-safe metadata as imports.
    if (batch) await waitForQueuedWrite(batch.id, batch.persisted);
  }
  // Keep a small receipt for reload/back navigation; the original bytes now belong to the
  // user's attachment store. A consumed share never rewrites a subsequently edited note.
  await saveIncomingShare({ ...share, complete: true, files: [], title: '', text: '', url: '' });
  return share.id;
}
