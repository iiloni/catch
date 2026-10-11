import {
  blocksToPlainText,
  type CreateNote,
  createNoteSchema,
  createNotesSchema,
  positionsBetween,
  updateNoteSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { deleteFiles } from '../attachments/files';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { attachments, notes, noteTags, reminders } from '../db/schema';
import {
  beforeContentWrite,
  deleteHistory,
  ensureHistory,
  HistoryFailure,
  preserveOrdinary,
} from '../history/store';
import { requireUser } from '../lib/requireUser';
import { refreshSharedNote } from '../lib/sharing';
import { lockTagTree } from '../lib/tagTreeLock';
import { queuePreviews, trackNoteLinks } from '../linkPreviews';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Electric streams changes by Postgres transaction id. Returning it lets the
 * client wait until its optimistic write has come back through sync.
 */
async function currentTxid(tx: Tx): Promise<number> {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}

/** Positions before all of the user's notes, for clients that do not send one. */
async function firstPositions(tx: Tx, userId: string, count: number) {
  if (count === 0) return [];
  // The "C" collation compares by byte, as positions require.
  const [row] = await tx
    .select({ first: sql<string | null>`min(${notes.position} collate "C")` })
    .from(notes)
    .where(eq(notes.userId, userId));
  return positionsBetween(null, row?.first ?? null, count);
}

/** A client's clock may run ahead; a note cannot have been made after it reached us. */
const notLater = (date: Date | undefined, now: Date) => (date && date > now ? now : date);

class NoteIdTaken extends Error {}

/**
 * Adds new notes, skipping any the user already has: clients replay queued writes, so a
 * note may be here from an earlier try. Returns null when every note was already here, and
 * throws `NoteIdTaken` when another user has one of the ids.
 */
async function insertNotes(tx: Tx, userId: string, bodies: readonly CreateNote[]) {
  const now = new Date();
  const positions = await firstPositions(
    tx,
    userId,
    bodies.filter((body) => !body.position).length,
  );
  const rows = bodies.map((body) => ({
    ...body,
    position: body.position ?? (positions.shift() as string),
    createdAt: notLater(body.createdAt, now),
    updatedAt: notLater(body.updatedAt, now),
    userId,
    searchText: blocksToPlainText(body.content),
  }));
  const inserted = await tx
    .insert(notes)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: notes.id });
  const added = new Set(inserted.map((row) => row.id));
  const replayed = rows.filter((row) => !added.has(row.id)).map((row) => row.id);
  if (replayed.length > 0) {
    const mine = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.userId, userId), inArray(notes.id, replayed)));
    if (mine.length < new Set(replayed).size) throw new NoteIdTaken();
  }
  if (added.size === 0) return null;
  for (const row of rows.filter((row) => added.has(row.id))) {
    const control = await ensureHistory(tx, userId, row.id, 'note');
    if (row.content.length) await preserveOrdinary(tx, control, row.content, 'baseline');
  }
  const links = await trackNoteLinks(
    tx,
    userId,
    rows.filter((row) => added.has(row.id)).map((row) => row.content),
  );
  return { txid: await currentTxid(tx), links };
}

async function createNotes(c: Context<AppEnv>, bodies: readonly CreateNote[]) {
  const user = c.get('user')!;
  let result: Awaited<ReturnType<typeof insertNotes>>;
  try {
    result = await db.transaction((tx) => insertNotes(tx, user.id, bodies));
  } catch (error) {
    if (error instanceof NoteIdTaken) return c.json({ error: 'Note id is taken' }, 409);
    throw error;
  }
  if (result === null) return c.json({ txid: null });
  queuePreviews(user.id, result.links);
  return c.json({ txid: result.txid }, 201);
}

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const notesRoutes = new Hono<AppEnv>()
  .onError((error, c) => {
    if (error instanceof HistoryFailure)
      return c.json({ code: error.code, error: error.message }, 409);
    throw error;
  })
  .use(requireUser)
  .post('/', zValidator('json', createNoteSchema), (c) => createNotes(c, [c.req.valid('json')]))
  // Imports and copies of several notes arrive together.
  .post('/batch', zValidator('json', createNotesSchema), (c) =>
    createNotes(c, c.req.valid('json').notes),
  )
  .patch('/:id', idParam, zValidator('json', updateNoteSchema), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const { history, ...body } = c.req.valid('json');
    // Rearranging notes or hiding a link's preview is not editing them, so it leaves
    // "Last edited" alone.
    const notAnEdit = Object.keys(body).every(
      (key) => key === 'position' || key === 'hiddenLinks' || key === 'galleryPreviewUrl',
    );
    const result = await db.transaction(async (tx) => {
      if (body.color !== undefined) await lockTagTree(tx, user.id);
      if (body.content !== undefined) {
        const [current] = await tx
          .select()
          .from(notes)
          .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
          .for('update');
        if (!current) return null;
        const control = await ensureHistory(tx, user.id, id, 'note');
        if (!(await beforeContentWrite(tx, control, current, history, body)))
          return { txid: null, links: [], readers: [] };
      }
      const updated = await tx
        .update(notes)
        .set({
          ...body,
          ...(body.content ? { searchText: blocksToPlainText(body.content) } : {}),
          ...(notAnEdit ? { updatedAt: sql`${notes.updatedAt}` } : {}),
        })
        .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
        .returning({ id: notes.id });
      if (updated.length === 0) return null;
      // A plain color edit, including one queued before tags existed, replaces the primary.
      // New tag selections follow this request with their explicit assignment write.
      if (body.color !== undefined) {
        await tx
          .update(noteTags)
          .set({ primaryTagId: null })
          .where(and(eq(noteTags.id, id), eq(noteTags.userId, user.id)));
      }
      const links = body.content ? await trackNoteLinks(tx, user.id, [body.content]) : [];
      // Rearranging, pinning and the like change nothing a reader of the note sees.
      const readers =
        body.content || body.color !== undefined || body.deletedAt !== undefined
          ? await refreshSharedNote(tx, id, user.id)
          : [];
      return { txid: await currentTxid(tx), links, readers };
    });
    if (result === null) return c.json({ error: 'Note not found' }, 404);
    queuePreviews(user.id, result.links);
    for (const reader of result.readers) queuePreviews(reader.userId, reader.links);
    return c.json({ txid: result.txid });
  })
  .delete('/:id', idParam, async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
        .returning({ id: notes.id });
      if (deleted.length === 0) return null;
      await deleteHistory(tx, user.id, id);
      // Reminders and attachments have no foreign key to follow the note out (see the schema).
      await tx
        .delete(reminders)
        .where(and(eq(reminders.noteId, id), eq(reminders.userId, user.id)));
      // Only the files of a note deleted here: the id may be a vault note's, whose files
      // must outlive a request that deleted nothing.
      const files = await tx
        .delete(attachments)
        .where(and(eq(attachments.noteId, id), eq(attachments.userId, user.id)))
        .returning({ id: attachments.id });
      return { txid: await currentTxid(tx), files: files.map((file) => file.id) };
    });
    await deleteFiles(result?.files ?? []);
    // Already gone, perhaps deleted by an earlier try of this same queued write.
    return c.json({ txid: result?.txid ?? null });
  });
