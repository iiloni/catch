import { Capacitor } from '@capacitor/core';
import {
  type Attachment,
  attachmentKind,
  attachmentSchema,
  attachmentUrl,
  MAX_ATTACHMENT_BYTES,
  type Note,
  removeAttachmentBlocks,
  VAULT_FILE_NAME,
  VAULT_FILE_TYPE,
  type VaultFile,
} from '@catch/shared';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import {
  forgetAttachmentBlob,
  getAttachmentBlob,
  openSealedFile,
  storeAttachmentBlob,
  storeSealedBlob,
} from './attachmentFiles';
import { getAuthToken } from './auth';
import { attachmentsCollection, notesCollection, useAttachments, write } from './collections';
import { compatibleFetch } from './compatibility';
import { editorControls, editorNote } from './dockState';
import type { ImportBatch } from './notes';
import { getServerUrl } from './serverUrl';
import { makeThumbnail } from './thumbnails';
import {
  changeVaultNote,
  changeVaultNoteFiles,
  getSealedFiles,
  getVaultFiles,
  getVaultNote,
  isVaultNote,
  vaultFileKey,
  vaultFileNote,
  vaultNotes,
} from './vault';
import { sealedFileSize, sealFile } from './vaultCrypto';

/**
 * A note's files. A vault note's are the ones sealed inside it (ADR 0020): the rows that
 * hold their bytes say nothing of what they are, beyond whether one has been removed.
 */
export function useNoteAttachments(noteId: string) {
  const rows = useAttachments();
  vaultNotes.use();
  if (!isVaultNote(noteId)) return rows.filter((file) => file.noteId === noteId && !file.deletedAt);
  const removed = new Set(rows.filter((row) => row.deletedAt).map((row) => row.id));
  return getVaultFiles(noteId).filter((file) => !removed.has(file.id));
}

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
  if (isVaultNote(noteId)) return { attachment: await storeVaultFile(noteId, file), batch: null };
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

/** The row that holds a sealed file's bytes. The server learns its size and its note. */
const sealedRow = (id: string, note: { id: string; userId: string }, size: number): Attachment => ({
  id,
  noteId: note.id,
  userId: note.userId,
  name: VAULT_FILE_NAME,
  mimeType: VAULT_FILE_TYPE,
  size,
  kind: 'file',
  status: 'pending',
  sourceId: null,
  createdAt: new Date(),
  deletedAt: null,
});

/**
 * Adds a file to a vault note: sealed here, with a thumbnail made here, since the server
 * can read neither. What the file is called and what it is go inside the note.
 */
async function storeVaultFile(noteId: string, file: File): Promise<Attachment> {
  const key = vaultFileKey();
  const note = getVaultNote(noteId);
  if (!key || !note || note.deletedAt) throw new Error('This note is no longer editable');
  if (!file.size) throw new Error('The file is empty');
  if (sealedFileSize(file.size) > MAX_ATTACHMENT_BYTES)
    throw new Error('Choose a file smaller than 100 MB');
  const mimeType = file.type.split(';')[0] || 'application/octet-stream';
  const kind = attachmentKind(mimeType);
  const id = uuidv7();
  const thumbnail = await makeThumbnail(file, kind);
  const entry: VaultFile = {
    id,
    name: file.name.slice(0, 255) || 'Attachment',
    mimeType,
    size: file.size,
    kind,
    createdAt: new Date(),
    thumbnailId: thumbnail ? uuidv7() : null,
    sealId: id,
  };
  const rows = [sealedRow(id, note, sealedFileSize(file.size))];
  await storeSealedBlob(id, await sealFile(key, note.userId, id, 'content', file), true);
  if (thumbnail && entry.thumbnailId) {
    rows.push(sealedRow(entry.thumbnailId, note, sealedFileSize(thumbnail.size)));
    await storeSealedBlob(
      entry.thumbnailId,
      await sealFile(key, note.userId, id, 'thumbnail', thumbnail),
      true,
    );
  }
  // The vault may have locked, or the note gone, while the file was being sealed.
  if (!getVaultNote(noteId) || getVaultNote(noteId)?.deletedAt) {
    for (const row of rows) await forgetAttachmentBlob(row.id);
    throw new Error('This note is no longer editable');
  }
  const transaction = write(() => {
    attachmentsCollection.insert(rows);
    changeVaultNoteFiles(noteId, (files) => [...files, entry]);
  });
  transaction.isPersisted.promise.catch(() => toast.error(`${entry.name} could not be uploaded`));
  const added = getVaultFiles(noteId).find((item) => item.id === id);
  if (!added) throw new Error('This note is no longer editable');
  return added;
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
  const vaultNote = vaultFileNote(id);
  if (vaultNote) {
    write(() =>
      changeVaultNoteFiles(vaultNote, (files) =>
        files.map((file) => (file.id === id ? { ...file, name: value } : file)),
      ),
    );
    return;
  }
  // A sealed file's row never carries its name: with the vault locked there is nothing to rename.
  const row = attachmentsCollection.get(id);
  if (!row || !notesCollection.has(row.noteId)) return;
  write(() =>
    attachmentsCollection.update(id, (draft) => {
      draft.name = value;
    }),
  );
}

export function removeAttachment(attachment: Attachment) {
  const controls = editorNote.get()?.id === attachment.noteId ? editorControls.get() : null;
  controls?.removeAttachment(attachment.id);
  if (isVaultNote(attachment.noteId)) {
    removeVaultFile(attachment, controls?.getContent());
    return;
  }
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

function removeVaultFile(attachment: Attachment, content: Note['content'] | undefined) {
  const noteId = attachment.noteId;
  const thumbnailId = getSealedFiles(noteId).find((file) => file.id === attachment.id)?.thumbnailId;
  const rows = [attachment.id, ...(thumbnailId ? [thumbnailId] : [])].filter((id) =>
    attachmentsCollection.has(id),
  );
  const transaction = write(() => {
    if (rows.length > 0) {
      attachmentsCollection.update(rows, (drafts) => {
        for (const draft of drafts) draft.deletedAt = new Date();
      });
    }
    changeVaultNoteFiles(noteId, (files) => files.filter((file) => file.id !== attachment.id));
    changeVaultNote(noteId, (draft) => {
      draft.content = removeAttachmentBlocks(content ?? draft.content, attachment.id);
      draft.updatedAt = new Date();
    });
  });
  void transaction.isPersisted.promise.then(
    async () => {
      for (const id of rows) await forgetAttachmentBlob(id);
    },
    () => {},
  );
}

export async function downloadAttachment(attachment: Attachment) {
  const local = vaultFileNote(attachment.id)
    ? await openSealedFile(attachment.id)
    : await getAttachmentBlob(attachment.id);
  let blob = local;
  if (!blob) {
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
