import { Capacitor } from '@capacitor/core';
import { DEFAULT_BOARD_STATUS } from '@catch/shared';
import { importAttachment } from './attachments';
import { getSignedInUser } from './auth';
import { loadShareCollections, waitForQueuedWrite, waitForWriteStored } from './collections';
import { rememberedHomePage } from './homePage';
import {
  capturedLinkContent,
  type IncomingLinkCapture,
  incomingLinkDraft,
  type LinkCaptureDraft,
} from './linkCapture';
import { type LinkCapturePlacement, resolveLinkCapturePlacement } from './linkCapturePlacement';
import { createNote, hasNote, updateNote } from './notes';
import { sharedNoteContent } from './shareContent';
import { getIncomingShare, saveIncomingShare } from './shareInbox';

const active = new Map<string, Promise<string>>();

type PreparedShare =
  | ({ kind: 'link' } & IncomingLinkCapture)
  | { kind: 'note'; id: string }
  | { kind: 'dismissed' };

function withShareLock<T>(id: string, run: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request(`catch-share-${id}`, run) : run();
}

async function claimShare(id: string) {
  const user = getSignedInUser();
  if (!user) throw new Error('Sign in to save the shared content.');
  const share = await getIncomingShare(id);
  if (!share)
    throw new Error('This share is no longer available. Share it from the other app again.');
  if (share.userId && share.userId !== user.id)
    throw new Error(
      'This share belongs to another account. Sign in to that account to finish saving it.',
    );
  if (!share.userId) {
    share.userId = user.id;
    await saveIncomingShare(share);
  }
  return { share, user };
}

/** Link shares await explicit Save; files and plain text retain immediate note creation. */
export async function prepareShare(id: string): Promise<PreparedShare> {
  const prepared = await withShareLock(id, async (): Promise<PreparedShare | null> => {
    const { share } = await claimShare(id);
    if (share.dismissed) return { kind: 'dismissed' };
    if (share.complete) return { kind: 'note', id };
    const draft = incomingLinkDraft(share);
    return draft
      ? {
          kind: 'link',
          id,
          draft,
          initialStatus:
            Capacitor.getPlatform() === 'android' && rememberedHomePage() === '/deck'
              ? DEFAULT_BOARD_STATUS
              : null,
        }
      : null;
  });
  return prepared ?? { kind: 'note', id: await receiveShare(id) };
}

export function saveLinkShare(
  id: string,
  draft: LinkCaptureDraft,
  placement?: LinkCapturePlacement,
): Promise<string> {
  return withShareLock(id, async () => {
    const { share, user } = await claimShare(id);
    if (share.dismissed)
      throw new Error('This share was cancelled. Share the link again to save it.');
    if (share.complete) return id;
    if (!incomingLinkDraft(share)) throw new Error('This share is not a single web link.');
    await loadShareCollections();
    const content = capturedLinkContent(draft);
    const transaction = hasNote(id)
      ? updateNote(id, { content })
      : createNote({
          id,
          userId: user.id,
          content,
          ...(placement && resolveLinkCapturePlacement(placement)),
        }).transaction;
    await waitForWriteStored(transaction);
    await saveIncomingShare({ ...share, complete: true, files: [], title: '', text: '', url: '' });
    return id;
  });
}

/** Keep a receipt so repeat delivery cannot resurrect a deliberately cancelled capture. */
export function dismissLinkShare(id: string): Promise<void> {
  return withShareLock(id, async () => {
    const { share } = await claimShare(id);
    if (share.complete) return;
    if (!incomingLinkDraft(share)) throw new Error('This share is not a single web link.');
    await saveIncomingShare({
      ...share,
      complete: true,
      dismissed: true,
      files: [],
      title: '',
      text: '',
      url: '',
    });
  });
}

export function receiveShare(id: string): Promise<string> {
  const previous = active.get(id);
  if (previous) return previous;
  const run = () => consume(id);
  // A POST can launch a second window. Only one window may consume a share at a time.
  const promise = withShareLock(id, run);
  active.set(id, promise);
  void promise.finally(() => active.delete(id)).catch(() => {});
  return promise;
}

async function consume(id: string) {
  const { share, user } = await claimShare(id);
  if (share.dismissed) throw new Error('This share was cancelled.');
  if (share.complete) return share.id;
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
