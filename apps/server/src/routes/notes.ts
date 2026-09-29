import {
  blocksToPlainText,
  createNoteSchema,
  positionBetween,
  updateNoteSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { notes } from '../db/schema';
import { requireUser } from '../lib/requireUser';
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

/** A position before all of the user's notes, for clients that do not send one. */
async function firstPosition(tx: Tx, userId: string) {
  // The "C" collation compares by byte, as positions require.
  const [row] = await tx
    .select({ first: sql<string | null>`min(${notes.position} collate "C")` })
    .from(notes)
    .where(eq(notes.userId, userId));
  return positionBetween(null, row?.first ?? null);
}

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const notesRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createNoteSchema), async (c) => {
    const user = c.get('user')!;
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(notes)
        .values({
          ...body,
          position: body.position ?? (await firstPosition(tx, user.id)),
          userId: user.id,
          searchText: blocksToPlainText(body.content),
        })
        .onConflictDoNothing()
        .returning({ id: notes.id });
      if (inserted.length === 0) return null;
      const links = await trackNoteLinks(tx, user.id, body.content);
      return { txid: await currentTxid(tx), links };
    });
    if (result === null) {
      // Clients replay queued writes, so the note may already be here from an earlier try.
      const [existing] = await db
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, body.id), eq(notes.userId, user.id)));
      if (!existing) return c.json({ error: 'Note id is taken' }, 409);
      return c.json({ txid: null });
    }
    queuePreviews(user.id, result.links);
    return c.json({ txid: result.txid }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateNoteSchema), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    // Rearranging notes or hiding a link's preview is not editing them, so it leaves
    // "Last edited" alone.
    const notAnEdit = Object.keys(body).every((key) => key === 'position' || key === 'hiddenLinks');
    const result = await db.transaction(async (tx) => {
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
      const links = body.content ? await trackNoteLinks(tx, user.id, body.content) : [];
      return { txid: await currentTxid(tx), links };
    });
    if (result === null) return c.json({ error: 'Note not found' }, 404);
    queuePreviews(user.id, result.links);
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
      return deleted.length > 0 ? currentTxid(tx) : null;
    });
    // Already gone, perhaps deleted by an earlier try of this same queued write.
    if (result === null) return c.json({ txid: null });
    return c.json({ txid: result });
  });
