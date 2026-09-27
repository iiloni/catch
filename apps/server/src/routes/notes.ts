import { blocksToPlainText, createNoteSchema, updateNoteSchema } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { notes } from '../db/schema';
import { requireUser } from '../lib/requireUser';

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

const idParam = zValidator('param', z.object({ id: z.uuid() }));

export const notesRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createNoteSchema), async (c) => {
    const user = c.get('user')!;
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      await tx.insert(notes).values({
        ...body,
        userId: user.id,
        searchText: blocksToPlainText(body.content),
      });
      return currentTxid(tx);
    });
    return c.json({ txid }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateNoteSchema), async (c) => {
    const user = c.get('user')!;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      const updated = await tx
        .update(notes)
        .set({
          ...body,
          ...(body.content ? { searchText: blocksToPlainText(body.content) } : {}),
        })
        .where(and(eq(notes.id, id), eq(notes.userId, user.id)))
        .returning({ id: notes.id });
      return updated.length > 0 ? currentTxid(tx) : null;
    });
    if (result === null) return c.json({ error: 'Note not found' }, 404);
    return c.json({ txid: result });
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
    if (result === null) return c.json({ error: 'Note not found' }, 404);
    return c.json({ txid: result });
  });
