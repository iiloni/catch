import {
  createBoardColumnSchema,
  DEFAULT_BOARD_STATUS,
  updateBoardColumnSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { boardColumns, notes } from '../db/schema';
import { requireUser } from '../lib/requireUser';

const idParam = zValidator('param', z.object({ id: z.string().min(1).max(64) }));

export const boardColumnRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .post('/', zValidator('json', createBoardColumnSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    if (body.id === DEFAULT_BOARD_STATUS) return c.json({ error: 'Reserved column id' }, 409);
    const txid = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(boardColumns)
        .values({ ...body, userId })
        // Clients replay queued writes, so the column may already be here from an earlier try.
        .onConflictDoNothing()
        .returning({ id: boardColumns.id });
      if (inserted.length === 0) return null;
      const [row] = await tx.execute<{ txid: string }>(
        sql`SELECT pg_current_xact_id()::xid::text AS txid`,
      );
      return Number(row?.txid);
    });
    if (txid === null) return c.json({ txid: null });
    return c.json({ txid }, 201);
  })
  .patch('/:id', idParam, zValidator('json', updateBoardColumnSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(boardColumns)
        .set(body)
        .where(and(eq(boardColumns.userId, userId), eq(boardColumns.id, id)))
        .returning({ id: boardColumns.id });
      if (updated.length === 0) return null;
      const [row] = await tx.execute<{ txid: string }>(
        sql`SELECT pg_current_xact_id()::xid::text AS txid`,
      );
      return Number(row?.txid);
    });
    if (txid === null) return c.json({ error: 'Column not found' }, 404);
    return c.json({ txid });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    if (id === DEFAULT_BOARD_STATUS) return c.json({ error: 'Default column is protected' }, 403);
    const txid = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(boardColumns)
        .where(and(eq(boardColumns.userId, userId), eq(boardColumns.id, id)))
        .returning({ id: boardColumns.id });
      if (deleted.length === 0) return null;
      await tx
        .update(notes)
        .set({ status: DEFAULT_BOARD_STATUS })
        .where(and(eq(notes.userId, userId), eq(notes.status, id)));
      const [row] = await tx.execute<{ txid: string }>(
        sql`SELECT pg_current_xact_id()::xid::text AS txid`,
      );
      return Number(row?.txid);
    });
    // Already gone, perhaps deleted by an earlier try of this same queued write.
    if (txid === null) return c.json({ txid: null });
    return c.json({ txid });
  });
