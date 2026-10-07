import { z } from 'zod';
import { type Attachment, attachmentId, attachmentSchema } from './attachments';
import { type Note, noteColorSchema, noteContentSchema, notePositionSchema } from './notes';

/** 32 random bytes in base64url. Whoever holds a note's token can read the note. */
export const shareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * A note's share link (ADR 0020), at most one, so the note's id is its key. The device makes
 * the token, so a link can be made offline and copied again later.
 */
export const noteShareSchema = z.object({
  noteId: z.uuid({ version: 'v7' }),
  userId: z.string(),
  token: shareTokenSchema,
  createdAt: z.coerce.date(),
});
export type NoteShare = z.infer<typeof noteShareSchema>;

export const createNoteShareSchema = noteShareSchema.pick({ token: true });
export type CreateNoteShare = z.infer<typeof createNoteShareSchema>;

/** A file of a shared note, as much as someone reading the note needs of it. */
export const sharedAttachmentSchema = attachmentSchema.pick({
  id: true,
  name: true,
  mimeType: true,
  size: true,
  kind: true,
  createdAt: true,
});
export type SharedAttachment = z.infer<typeof sharedAttachmentSchema>;

/**
 * Someone else's note in a user's gallery: the server's copy of it for that user, rewritten
 * whenever its owner changes the note. Where it sits, and whether it is pinned or archived,
 * is the user's own.
 */
export const sharedNoteSchema = z.object({
  noteId: z.uuid({ version: 'v7' }),
  /** Whose gallery this is in. */
  userId: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  content: noteContentSchema,
  color: noteColorSchema,
  attachments: z.array(sharedAttachmentSchema),
  /** False while the note is in its owner's trash: it comes back if they restore it. */
  isAvailable: z.boolean(),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  position: notePositionSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SharedNote = z.infer<typeof sharedNoteSchema>;

export const updateSharedNoteSchema = sharedNoteSchema
  .pick({ isPinned: true, isArchived: true, position: true })
  .partial();
export type UpdateSharedNote = z.infer<typeof updateSharedNoteSchema>;

/**
 * What a share link shows. `viewer` says what the reader may do next: a `guest` is not signed
 * in, a `user` can add the note to their gallery, a `member` already has, and the `owner`
 * has it as their own.
 */
export const sharedNoteViewSchema = z.object({
  noteId: z.uuid({ version: 'v7' }),
  ownerName: z.string(),
  content: noteContentSchema,
  color: noteColorSchema,
  attachments: z.array(sharedAttachmentSchema),
  updatedAt: z.coerce.date(),
  viewer: z.enum(['guest', 'user', 'member', 'owner']),
});
export type SharedNoteView = z.infer<typeof sharedNoteViewSchema>;

export const acceptShareResponseSchema = z.object({
  noteId: z.uuid({ version: 'v7' }),
  txid: z.number().int().nullable(),
});
export type AcceptShareResponse = z.infer<typeof acceptShareResponseSchema>;

export const SHARE_PATH = '/s';

/** The link a shared note is read at. */
export function shareLink(serverUrl: string, token: string) {
  return new URL(`${SHARE_PATH}/${token}`, serverUrl).href;
}

/** Where a share link's reader loads one of the note's files from, with no account. */
export function sharedAttachmentPath(token: string, id: string) {
  return `/api/shares/${token}/attachments/${id}/content`;
}

/**
 * A shared note as the gallery shows it. `userId` stays its owner's, which is how the app
 * tells it from the user's own notes (see `isSharedNote`).
 */
export function sharedNoteAsNote(shared: SharedNote): Note {
  return {
    id: shared.noteId,
    userId: shared.ownerId,
    content: shared.content,
    color: shared.color,
    status: null,
    isPinned: shared.isPinned,
    isArchived: shared.isArchived,
    position: shared.position,
    hiddenLinks: [],
    createdAt: shared.createdAt,
    updatedAt: shared.updatedAt,
    deletedAt: null,
  };
}

/** A shared note's files, shaped like the reader's own so the same views show them. */
export function sharedAttachments(
  note: Pick<SharedNote, 'noteId' | 'ownerId' | 'attachments'>,
): Attachment[] {
  return note.attachments.map((file) => ({
    ...file,
    // Synced rows skip the schema, and a date inside JSON arrives as text.
    createdAt: new Date(file.createdAt),
    userId: note.ownerId,
    noteId: note.noteId,
    status: 'ready',
    sourceId: null,
    deletedAt: null,
  }));
}

type Block = Record<string, unknown>;
const isBlock = (value: unknown): value is Block =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A shared note's content with each file block pointing at `resolve`'s address for its file,
 * in place of the `attachment:<id>` only its owner's devices can follow.
 */
export function resolveAttachmentBlocks(
  blocks: readonly Block[],
  resolve: (id: string) => string,
): Block[] {
  return blocks.map((block) => {
    const props = isBlock(block.props) ? block.props : {};
    const id = typeof props.url === 'string' ? attachmentId(props.url) : null;
    return {
      ...block,
      ...(id ? { props: { ...props, url: resolve(id) } } : {}),
      ...(Array.isArray(block.children)
        ? { children: resolveAttachmentBlocks(block.children.filter(isBlock), resolve) }
        : {}),
    };
  });
}
