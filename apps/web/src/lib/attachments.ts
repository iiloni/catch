import { Capacitor } from '@capacitor/core';
import {
  type Attachment,
  attachmentKind,
  attachmentSchema,
  attachmentUrl,
  MAX_ATTACHMENT_BYTES,
  removeAttachmentBlocks,
} from '@catch/shared';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { forgetAttachmentBlob, getAttachmentBlob, storeAttachmentBlob } from './attachmentFiles';
import { attachmentsCollection, notesCollection, useAttachments, write } from './collections';
import { editorControls, editorNote } from './dockState';
import type { ImportBatch } from './notes';

export const useNoteAttachments = (noteId: string) =>
  useAttachments().filter((file) => file.noteId === noteId && !file.deletedAt);

export function useRemovedAttachmentIds(noteId: string | undefined) {
  const files = useAttachments();
  return useMemo(
    () => files.filter((file) => file.noteId === noteId && file.deletedAt).map((file) => file.id),
    [files, noteId],
  );
}

export type ImportedAttachment = {
  id: string;
  noteId: string;
  createdAt: Date;
  read: () => Promise<File>;
};

/** Includes tombstones so importing again respects attachments deliberately removed. */
export const hasAttachment = (id: string) => attachmentsCollection.has(id);

/** Store bytes before queuing metadata; a reload can always finish the queued upload. */
export async function addAttachment(noteId: string, file: File): Promise<Attachment> {
  return (await storeAttachment(noteId, file, uuidv7(), new Date())).attachment;
}

export async function importAttachment(
  source: ImportedAttachment,
  file: File,
  signal: AbortSignal,
): Promise<ImportBatch | null> {
  if (hasAttachment(source.id)) return null;
  return (await storeAttachment(source.noteId, file, source.id, source.createdAt, signal)).batch;
}

async function storeAttachment(
  noteId: string,
  file: File,
  id: string,
  createdAt: Date,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const note = notesCollection.get(noteId);
  if (!note || note.deletedAt) throw new Error('This note is no longer editable');
  if (!file.size) throw new Error('The file is empty');
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Choose a file smaller than 100 MB');
  const mimeType = file.type.split(';')[0] || 'application/octet-stream';
  const attachment: Attachment = {
    id,
    noteId,
    userId: note.userId,
    name: file.name.slice(0, 255) || 'Attachment',
    mimeType,
    size: file.size,
    kind: attachmentKind(mimeType),
    status: 'pending',
    sourceId: null,
    createdAt,
    deletedAt: null,
  };
  attachmentSchema.parse(attachment);
  await storeAttachmentBlob(id, file, true);
  // The picker may have outlived a switch to another note; keep the catalog entry on its
  // original note and never put it into the newly opened editor.
  if (signal?.aborted || !notesCollection.has(noteId) || notesCollection.get(noteId)?.deletedAt) {
    await forgetAttachmentBlob(id);
    throw new Error('This note is no longer editable');
  }
  const transaction = write(() => attachmentsCollection.insert(attachment));
  transaction.isPersisted.promise.catch(() =>
    toast.error(`${attachment.name} could not be uploaded`),
  );
  return {
    attachment,
    batch: { id: transaction.id, count: 1, persisted: transaction.isPersisted.promise },
  };
}

export async function attachFiles(
  noteId: string,
  files: readonly File[],
  insert: (attachments: Attachment[]) => void,
) {
  const added: Attachment[] = [];
  for (const file of files) {
    try {
      added.push(await addAttachment(noteId, file));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save the attachment on this device',
      );
    }
  }
  if (added.length) insert(added);
}

export function renameAttachment(id: string, name: string) {
  const value = name.trim();
  if (!value || value.length > 255) return;
  write(() =>
    attachmentsCollection.update(id, (draft) => {
      draft.name = value;
    }),
  );
}

export function removeAttachment(attachment: Attachment) {
  const controls = editorNote.get()?.id === attachment.noteId ? editorControls.get() : null;
  controls?.removeAttachment(attachment.id);
  const transaction = write(() => {
    attachmentsCollection.update(attachment.id, (draft) => {
      draft.deletedAt = new Date();
    });
    notesCollection.update(attachment.noteId, (draft) => {
      draft.content = removeAttachmentBlocks(
        controls?.getContent() ?? draft.content,
        attachment.id,
      );
      draft.updatedAt = new Date();
    });
  });
  void transaction.isPersisted.promise.then(
    () => forgetAttachmentBlob(attachment.id),
    () => {},
  );
}

export async function downloadAttachment(attachment: Attachment) {
  const local = await getAttachmentBlob(attachment.id);
  let blob = local;
  if (!blob) {
    const { getAuthToken } = await import('./auth');
    const { getServerUrl } = await import('./serverUrl');
    const { compatibleFetch } = await import('./compatibility');
    const response = await compatibleFetch(
      `${getServerUrl()}/api/attachments/${attachment.id}/content?download=true`,
      { headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` } },
    );
    if (!response.ok) throw new Error('Could not download attachment');
    blob = await response.blob();
  }
  if (Capacitor.isNativePlatform()) {
    const { saveNativeFile } = await import('./mediaPicker');
    return saveNativeFile(blob, attachment.name, attachment.mimeType);
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = attachment.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 30_000);
}

export const fileBlock = (attachment: Attachment) => ({
  type: attachment.kind,
  props: {
    url: attachmentUrl(attachment.id),
    name: attachment.name,
    caption: '',
    showPreview: attachment.kind !== 'file',
  },
});
