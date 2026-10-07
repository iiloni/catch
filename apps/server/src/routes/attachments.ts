import { copyFile } from 'node:fs/promises';
import {
  attachmentKind,
  blocksToPlainText,
  createAttachmentSchema,
  MAX_ATTACHMENT_BYTES,
  removeAttachmentBlocks,
  updateAttachmentSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { issueAccess, readAccess } from '../attachments/access';
import {
  createThumbnail,
  deleteFiles,
  filePath,
  fileResponse,
  storeFile,
  UploadError,
} from '../attachments/files';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { attachments, notes, vaultNotes } from '../db/schema';
import { env } from '../env';
import { requireUser } from '../lib/requireUser';

const idParam = zValidator('param', z.object({ id: z.uuid() }));
const owned = (id: string, userId: string) =>
  and(eq(attachments.id, id), eq(attachments.userId, userId));
/** Thrown inside the reservation's transaction to undo a row that does not fit the quota. */
class QuotaFull extends Error {}

async function currentTxid(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}

export const attachmentRoutes = new Hono<AppEnv>()
  .get('/:id/content', idParam, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('user')?.id ?? readAccess(c.req.query('access') ?? '', id);
    if (!userId) return c.json({ error: 'Unauthorized' }, 401);
    const [row] = await db
      .select()
      .from(attachments)
      .where(and(owned(id, userId), isNull(attachments.deletedAt)));
    if (row?.status !== 'ready') return c.json({ error: 'Not found' }, 404);
    const preview = c.req.query('preview') === 'true';
    if (preview) await createThumbnail(id, row.kind);
    return fileResponse(
      id,
      preview,
      row.kind === 'file' ? 'application/octet-stream' : row.mimeType,
      row.name,
      c.req.header('range'),
      c.req.query('download') === 'true',
    );
  })
  .use(requireUser)
  .get('/:id/access', idParam, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('user')!.id;
    const [row] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(owned(id, userId), isNull(attachments.deletedAt), eq(attachments.status, 'ready')),
      );
    if (!row) return c.json({ error: 'Not found' }, 404);
    const url = new URL(c.req.url);
    url.pathname = `/api/attachments/${id}/content`;
    url.search = new URLSearchParams({ access: issueAccess(userId, id) }).toString();
    return c.json({ url: url.toString() });
  })
  .post('/', zValidator('json', createAttachmentSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const [note] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(
        and(
          eq(notes.id, body.noteId),
          eq(notes.userId, userId),
          body.sourceId ? undefined : isNull(notes.deletedAt),
        ),
      );
    // A vault note's files are sealed on the device, and are only bytes here (ADR 0020).
    const [sealed] = note
      ? []
      : await db
          .select({ id: vaultNotes.id })
          .from(vaultNotes)
          .where(and(eq(vaultNotes.id, body.noteId), eq(vaultNotes.userId, userId)));
    if (!note && !sealed) return c.json({ error: 'Note not found' }, 404);
    const [existing] = await db.select().from(attachments).where(owned(body.id, userId));
    if (existing) {
      if (
        existing.noteId !== body.noteId ||
        existing.size !== body.size ||
        existing.mimeType !== body.mimeType ||
        existing.sourceId !== body.sourceId
      )
        return c.json({ error: 'Attachment id is taken' }, 409);
      if (!body.sourceId || existing.status === 'ready' || existing.deletedAt)
        return c.json({ txid: null });
    }
    if (body.sourceId) {
      const [source] = await db
        .select()
        .from(attachments)
        .where(
          and(
            owned(body.sourceId, userId),
            isNull(attachments.deletedAt),
            eq(attachments.status, 'ready'),
          ),
        );
      if (!source) return c.json({ error: 'Source attachment not found' }, 404);
      if (source.size !== body.size || source.mimeType !== body.mimeType)
        return c.json({ error: 'Source does not match' }, 400);
    }
    const quota = env.ATTACHMENT_QUOTA_MB * 1024 * 1024;
    let txid: number | null;
    try {
      txid = await db.transaction(async (tx) => {
        // One account's reservations take turns, so two at once cannot both fit under a
        // quota that has room for one.
        if (quota > 0)
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
        const added = await tx
          .insert(attachments)
          .values({
            ...body,
            userId,
            kind: attachmentKind(body.mimeType),
            status: 'pending',
          })
          .onConflictDoNothing()
          .returning({ id: attachments.id });
        if (!added.length) return null;
        if (quota > 0) {
          // Removed attachments have had their files deleted; ones still uploading hold
          // their place.
          const [used] = await tx
            .select({ bytes: sql<string>`coalesce(sum(${attachments.size}), 0)` })
            .from(attachments)
            .where(and(eq(attachments.userId, userId), isNull(attachments.deletedAt)));
          if (Number(used?.bytes ?? 0) > quota) throw new QuotaFull();
        }
        return currentTxid(tx);
      });
    } catch (error) {
      if (!(error instanceof QuotaFull)) throw error;
      return c.json({ error: 'Your attachment storage on this server is full' }, 413);
    }
    if (txid === null) {
      const [mine] = await db.select().from(attachments).where(owned(body.id, userId));
      if (
        !mine ||
        mine.noteId !== body.noteId ||
        mine.size !== body.size ||
        mine.mimeType !== body.mimeType ||
        mine.sourceId !== body.sourceId
      )
        return c.json({ error: 'Attachment id is taken' }, 409);
      if (mine.deletedAt || mine.status === 'ready') return c.json({ txid: null });
    }
    if (body.sourceId) {
      // Reserve ownership in Postgres before touching this id's files. A conflicting id
      // must never overwrite another user's bytes, even if the caller knows the UUID.
      await copyFile(filePath(body.sourceId), filePath(body.id));
      await createThumbnail(body.id, attachmentKind(body.mimeType));
      txid = await db.transaction(async (tx) => {
        const updated = await tx
          .update(attachments)
          .set({ status: 'ready' })
          .where(and(owned(body.id, userId), isNull(attachments.deletedAt)))
          .returning({ id: attachments.id });
        return updated.length ? currentTxid(tx) : null;
      });
      if (txid === null) await deleteFiles([body.id]);
    }
    return c.json({ txid }, 201);
  })
  .put('/:id/content', idParam, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('user')!.id;
    const [row] = await db.select().from(attachments).where(owned(id, userId));
    if (!row) return c.json({ error: 'Not found' }, 404);
    // A lost response or a later removal must not recreate a file on replay.
    if (row.status === 'ready' || row.deletedAt) return c.json({ txid: null });
    const length = c.req.header('content-length');
    if (length && (Number(length) > MAX_ATTACHMENT_BYTES || Number(length) !== row.size))
      return c.json({ error: 'File size does not match' }, 413);
    if (!c.req.raw.body) return c.json({ error: 'Missing file' }, 400);
    try {
      await storeFile(id, c.req.raw.body, row.size);
    } catch (error) {
      if (error instanceof UploadError) return c.json({ error: error.message }, 413);
      throw error;
    }
    await createThumbnail(id, row.kind);
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(attachments)
        .set({ status: 'ready' })
        .where(and(owned(id, userId), isNull(attachments.deletedAt)))
        .returning({ id: attachments.id });
      return updated.length ? currentTxid(tx) : null;
    });
    if (txid === null) await deleteFiles([id]);
    return c.json({ txid });
  })
  .patch('/:id', idParam, zValidator('json', updateAttachmentSchema), async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    // Removed files cannot be restored after their bytes have been deleted.
    if (body.deletedAt === null)
      return c.json({ error: 'Cannot restore a removed attachment' }, 400);
    const result = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(attachments).where(owned(id, userId)).for('update');
      if (!row) return null;
      if (row.deletedAt) return { txid: null, removed: true };
      if (body.deletedAt) {
        const [note] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.id, row.noteId), eq(notes.userId, userId)))
          .for('update');
        if (note)
          await tx
            .update(notes)
            .set({
              content: removeAttachmentBlocks(note.content, id),
              searchText: blocksToPlainText(removeAttachmentBlocks(note.content, id)),
            })
            .where(and(eq(notes.id, row.noteId), eq(notes.userId, userId)));
      }
      await tx.update(attachments).set(body).where(owned(id, userId));
      return { txid: await currentTxid(tx), removed: Boolean(body.deletedAt) };
    });
    if (result?.removed) await deleteFiles([id]);
    return c.json({ txid: result?.txid ?? null });
  });
