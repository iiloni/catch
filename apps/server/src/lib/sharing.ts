import { type Tag, tagColor } from '@catch/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { db } from '../db/client';
import { attachments, noteShares, notes, noteTags, sharedNotes, tags, user } from '../db/schema';
import { trackNoteLinks } from '../linkPreviews';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Take the note lock before attachment/assignment locks and hold it through publication. */
export async function lockSharedNote(tx: Tx, noteId: string, ownerId: string) {
  await tx
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, ownerId)))
    .for('update');
}

/**
 * What a reader may see of a note now, or null when there is no such note. A note in the
 * trash is shared as nothing, and says so.
 */
export async function sharedSnapshot(tx: Tx, noteId: string) {
  const [row] = await tx
    .select({ note: notes, ownerName: user.name, primaryTagId: noteTags.primaryTagId })
    .from(notes)
    .innerJoin(user, eq(user.id, notes.userId))
    .leftJoin(noteTags, eq(noteTags.id, notes.id))
    .where(eq(notes.id, noteId));
  if (!row) return null;
  const { note } = row;
  const isAvailable = note.deletedAt === null;
  const files = isAvailable
    ? await tx
        .select({
          id: attachments.id,
          name: attachments.name,
          mimeType: attachments.mimeType,
          size: attachments.size,
          kind: attachments.kind,
          createdAt: attachments.createdAt,
        })
        .from(attachments)
        .where(
          and(
            eq(attachments.noteId, noteId),
            eq(attachments.status, 'ready'),
            isNull(attachments.deletedAt),
          ),
        )
        .orderBy(attachments.createdAt, attachments.id)
    : [];
  // A note takes its primary tag's color (ADR 0016), and the reader has none of those tags.
  const color = row.primaryTagId
    ? tagColor(
        (await tx.select().from(tags).where(eq(tags.userId, note.userId))) as Tag[],
        row.primaryTagId,
      )
    : note.color;
  return {
    ownerId: note.userId,
    ownerName: row.ownerName,
    content: isAvailable ? note.content : [],
    color,
    attachments: files.map((file) => ({ ...file, createdAt: file.createdAt.toISOString() })),
    isAvailable,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/**
 * Rewrites the copies of a note in the galleries it was added to (ADR 0021). Call it in the
 * transaction of any change to what a reader sees: the note's content, color or trash, its
 * primary tag, or its files. Returns the links each reader has yet to get a preview of, to
 * queue once the transaction commits. A note nobody added costs one indexed lookup.
 */
export async function refreshSharedNote(tx: Tx, noteId: string, ownerId: string) {
  // Acceptance takes the same lock, including when there are no readers yet.
  await lockSharedNote(tx, noteId, ownerId);
  const readers = await tx
    .select({ userId: sharedNotes.userId })
    .from(sharedNotes)
    .where(eq(sharedNotes.noteId, noteId));
  if (readers.length === 0) return [];
  const snapshot = await sharedSnapshot(tx, noteId);
  if (!snapshot) return [];
  await tx.update(sharedNotes).set(snapshot).where(eq(sharedNotes.noteId, noteId));
  const previews: { userId: string; links: string[] }[] = [];
  for (const { userId } of readers) {
    previews.push({ userId, links: await trackNoteLinks(tx, userId, [snapshot.content]) });
  }
  return previews;
}

/** A tag tree change can change the shown color of any linked note of this owner. */
export async function lockOwnerSharedNotes(tx: Tx, ownerId: string) {
  const shares = await tx
    .select({ noteId: noteShares.noteId })
    .from(noteShares)
    .innerJoin(notes, eq(notes.id, noteShares.noteId))
    .where(eq(noteShares.userId, ownerId))
    .orderBy(noteShares.noteId)
    .for('update', { of: notes });
  return shares;
}

export async function refreshOwnerSharedNotes(tx: Tx, ownerId: string) {
  const shares = await lockOwnerSharedNotes(tx, ownerId);
  for (const { noteId } of shares) await refreshSharedNote(tx, noteId, ownerId);
}
