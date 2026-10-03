import {
  firstPending,
  reminderFireTime,
  reminderZone,
  reportTimeZoneSchema,
  saveReminderSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { notes, reminderSettings, reminders } from '../db/schema';
import { requireUser } from '../lib/requireUser';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function currentTxid(tx: Tx): Promise<number> {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}

const noteParam = zValidator('param', z.object({ noteId: z.uuid() }));

export const reminderRoutes = new Hono<AppEnv>()
  .use(requireUser)
  // Where the user is, which is where their floating reminders ring. Ahead of `/:noteId`.
  .put('/time-zone', zValidator('json', reportTimeZoneSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { timeZone, changed } = c.req.valid('json');
    const stored = await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ timeZone: reminderSettings.timeZone })
        .from(reminderSettings)
        .where(eq(reminderSettings.userId, userId))
        .for('update');
      // A device only saying where it is must not move a user another device has followed.
      if (before && (!changed || before.timeZone === timeZone)) return before.timeZone;
      await tx
        .insert(reminderSettings)
        .values({ userId, timeZone })
        .onConflictDoUpdate({ target: reminderSettings.userId, set: { timeZone } });
      const floating = await tx
        .select()
        .from(reminders)
        .where(and(eq(reminders.userId, userId), eq(reminders.floating, true)));
      for (const reminder of floating) {
        await tx
          .update(reminders)
          .set({ fireAt: reminderFireTime(reminder, timeZone) })
          .where(eq(reminders.noteId, reminder.noteId));
      }
      return timeZone;
    });
    return c.json({ timeZone: stored });
  })
  .put('/:noteId', noteParam, zValidator('json', saveReminderSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { noteId } = c.req.valid('param');
    const body = c.req.valid('json');
    const now = new Date();
    const txid = await db.transaction(async (tx) => {
      const [note] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, noteId), eq(notes.userId, userId)));
      if (!note) return null;
      const [settings] = await tx
        .select({ timeZone: reminderSettings.timeZone })
        .from(reminderSettings)
        .where(eq(reminderSettings.userId, userId));
      const zone = reminderZone(body, settings?.timeZone);
      const timing = {
        nextAt: firstPending(body, zone, now),
        snoozedUntil: body.snoozedUntil && body.snoozedUntil > now ? body.snoozedUntil : null,
      };
      const values = { ...body, ...timing, fireAt: reminderFireTime(timing, zone) };
      // Replaying this queued write lands on the same row and works the same times out again.
      await tx
        .insert(reminders)
        .values({ ...values, noteId, userId })
        .onConflictDoUpdate({ target: reminders.noteId, set: values });
      return currentTxid(tx);
    });
    if (txid === null) return c.json({ error: 'Note not found' }, 404);
    return c.json({ txid });
  })
  .delete('/:noteId', noteParam, async (c) => {
    const userId = c.get('user')!.id;
    const { noteId } = c.req.valid('param');
    const txid = await db.transaction(async (tx) => {
      const deleted = await tx
        .delete(reminders)
        .where(and(eq(reminders.noteId, noteId), eq(reminders.userId, userId)))
        .returning({ noteId: reminders.noteId });
      return deleted.length > 0 ? currentTxid(tx) : null;
    });
    // Already gone, perhaps removed by an earlier try of this same queued write.
    return c.json({ txid });
  });
