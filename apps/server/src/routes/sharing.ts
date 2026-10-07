import {
  type AcceptShareResponse,
  createNoteShareSchema,
  positionBetween,
  type SharedNoteView,
  shareTokenSchema,
  updateSharedNoteSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { createThumbnail, fileResponse } from '../attachments/files';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { attachments, noteShares, notes, sharedNotes } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { sharedSnapshot } from '../lib/sharing';
import { queuePreviews, trackNoteLinks } from '../linkPreviews';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function currentTxid(tx: Tx): Promise<number> {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}

const noteParam = zValidator('param', z.object({ noteId: z.uuid() }));

/** The owner's side: a note's link, made and removed through the outbox (ADR 0021). */
export const noteShareRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .put('/:noteId', noteParam, zValidator('json', createNoteShareSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { noteId } = c.req.valid('param');
    const { token } = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const [note] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
      if (!note) return 'missing';
      // A note keeps the link it has: a replay, or a second device sharing the same note,
      // lands on the first one's row and syncs its token back.
      const added = await tx
        .insert(noteShares)
        .values({ noteId, userId, token })
        .onConflictDoNothing()
        .returning({ noteId: noteShares.noteId });
      if (added.length) return currentTxid(tx);
      const [mine] = await tx
        .select({ noteId: noteShares.noteId })
        .from(noteShares)
        .where(and(eq(noteShares.noteId, noteId), eq(noteShares.userId, userId)));
      // Nothing was added and the note has no link: the token is another note's.
      return mine ? null : 'taken';
    });
    if (result === 'missing') return c.json({ error: 'Note not found' }, 404);
    if (result === 'taken') return c.json({ error: 'Share link is taken' }, 409);
    return c.json({ txid: result });
  })
  .delete('/:noteId', noteParam, async (c) => {
    const userId = c.get('user')!.id;
    const { noteId } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      // Takes the note out of every gallery it was added to as well (a cascade).
      const deleted = await tx
        .delete(noteShares)
        .where(and(eq(noteShares.noteId, noteId), eq(noteShares.userId, userId)))
        .returning({ noteId: noteShares.noteId });
      return deleted.length > 0 ? currentTxid(tx) : null;
    });
    // Already gone, perhaps removed by an earlier try of this same queued write.
    return c.json({ txid });
  });

/** The reader's side: where a note someone shared sits in their own gallery. */
export const sharedNoteRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .patch('/:noteId', noteParam, zValidator('json', updateSharedNoteSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { noteId } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(sharedNotes)
        .set(body)
        .where(and(eq(sharedNotes.noteId, noteId), eq(sharedNotes.userId, userId)))
        .returning({ noteId: sharedNotes.noteId });
      return updated.length > 0 ? currentTxid(tx) : null;
    });
    if (txid === null) return c.json({ error: 'Note not found' }, 404);
    return c.json({ txid });
  })
  .delete('/:noteId', noteParam, async (c) => {
    const userId = c.get('user')!.id;
    const { noteId } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(sharedNotes)
        .where(and(eq(sharedNotes.noteId, noteId), eq(sharedNotes.userId, userId)))
        .returning({ noteId: sharedNotes.noteId });
      return deleted.length > 0 ? currentTxid(tx) : null;
    });
    return c.json({ txid });
  });

const tokenParam = zValidator('param', z.object({ token: shareTokenSchema }));

/** The shared note a link's token stands for, unless it is in its owner's trash. */
async function sharedByToken(tx: Tx, token: string) {
  const [share] = await tx
    .select({ noteId: noteShares.noteId, ownerId: noteShares.userId })
    .from(noteShares)
    .innerJoin(notes, eq(notes.id, noteShares.noteId))
    .where(and(eq(noteShares.token, token), isNull(notes.deletedAt)));
  return share ?? null;
}

function viewerOf(
  userId: string | undefined,
  ownerId: string,
  isMember: boolean,
): SharedNoteView['viewer'] {
  if (!userId) return 'guest';
  if (userId === ownerId) return 'owner';
  return isMember ? 'member' : 'user';
}

/** A position ahead of everything in the user's gallery, their own notes and shared ones. */
async function firstPosition(tx: Tx, userId: string) {
  // The "C" collation compares by byte, as positions require.
  const [own] = await tx
    .select({ first: sql<string | null>`min(${notes.position} collate "C")` })
    .from(notes)
    .where(eq(notes.userId, userId));
  const [shared] = await tx
    .select({ first: sql<string | null>`min(${sharedNotes.position} collate "C")` })
    .from(sharedNotes)
    .where(eq(sharedNotes.userId, userId));
  const firsts = [own?.first, shared?.first]
    .filter((value): value is string => typeof value === 'string')
    .sort();
  return positionBetween(null, firsts[0] ?? null);
}

/**
 * What a share link opens (ADR 0021). The token is the whole of the permission to read, so
 * reading takes no account: these routes sit outside `requireUser`, and only adding the
 * note to a gallery asks for one.
 */
export const shareLinkRoutes = new Hono<AppEnv>()
  .get('/:token', tokenParam, async (c) => {
    const { token } = c.req.valid('param');
    const user = c.get('user');
    const view = await db.transaction(async (tx) => {
      const share = await sharedByToken(tx, token);
      const snapshot = share && (await sharedSnapshot(tx, share.noteId));
      if (!share || !snapshot) return null;
      const [member] = user
        ? await tx
            .select({ noteId: sharedNotes.noteId })
            .from(sharedNotes)
            .where(and(eq(sharedNotes.noteId, share.noteId), eq(sharedNotes.userId, user.id)))
        : [];
      return {
        noteId: share.noteId,
        ownerName: snapshot.ownerName,
        content: snapshot.content,
        color: snapshot.color,
        attachments: snapshot.attachments,
        updatedAt: snapshot.updatedAt,
        viewer: viewerOf(user?.id, share.ownerId, Boolean(member)),
      };
    });
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Robots-Tag', 'noindex');
    if (!view) return c.json({ error: 'This note is not shared' }, 404);
    return c.json(view);
  })
  .get(
    '/:token/attachments/:id/content',
    zValidator('param', z.object({ token: shareTokenSchema, id: z.uuid() })),
    async (c) => {
      const { token, id } = c.req.valid('param');
      const [row] = await db
        .select({ file: attachments })
        .from(attachments)
        .innerJoin(noteShares, eq(noteShares.noteId, attachments.noteId))
        .innerJoin(notes, eq(notes.id, attachments.noteId))
        .where(
          and(
            eq(attachments.id, id),
            eq(noteShares.token, token),
            eq(attachments.status, 'ready'),
            isNull(attachments.deletedAt),
            isNull(notes.deletedAt),
          ),
        );
      if (!row) return c.json({ error: 'Not found' }, 404);
      const { file } = row;
      const preview = c.req.query('preview') === 'true';
      if (preview) await createThumbnail(id, file.kind);
      return fileResponse(
        id,
        preview,
        file.kind === 'file' ? 'application/octet-stream' : file.mimeType,
        file.name,
        c.req.header('range'),
        c.req.query('download') === 'true',
      );
    },
  )
  .post('/:token/accept', requireUser, tokenParam, async (c) => {
    const { token } = c.req.valid('param');
    const userId = c.get('user')!.id;
    const result = await db.transaction(async (tx) => {
      const share = await sharedByToken(tx, token);
      const snapshot = share && (await sharedSnapshot(tx, share.noteId));
      if (!share || !snapshot) return null;
      // The owner has the note already; opening their own link changes nothing.
      if (share.ownerId === userId) return { noteId: share.noteId, txid: null, links: [] };
      const added = await tx
        .insert(sharedNotes)
        .values({
          ...snapshot,
          userId,
          noteId: share.noteId,
          position: await firstPosition(tx, userId),
        })
        .onConflictDoNothing()
        .returning({ noteId: sharedNotes.noteId });
      if (!added.length) return { noteId: share.noteId, txid: null, links: [] };
      return {
        noteId: share.noteId,
        txid: await currentTxid(tx),
        links: await trackNoteLinks(tx, userId, [snapshot.content]),
      };
    });
    if (!result) return c.json({ error: 'This note is not shared' }, 404);
    queuePreviews(userId, result.links);
    return c.json({ noteId: result.noteId, txid: result.txid } satisfies AcceptShareResponse);
  });
