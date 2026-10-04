import {
  DEFAULT_REMINDER_TIMES,
  DEFAULT_SNOOZE_MINUTES,
  firstPending,
  type Recurrence,
  type ReminderAlarms,
  type ReminderSettings,
  reminderAlarm,
  reminderFireTime,
  reminderZone,
  reportTimeZoneSchema,
  saveReminderSchema,
  saveReminderSettingsSchema,
  snoozeMinutesSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, isNull, sql } from 'drizzle-orm';
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

function sameRecurrence(a: Recurrence | null, b: Recurrence | null) {
  if (!a || !b) return a === b;
  return (
    a.frequency === b.frequency &&
    a.interval === b.interval &&
    a.weekdays.join() === b.weekdays.join() &&
    a.weekdayOfMonth?.ordinal === b.weekdayOfMonth?.ordinal &&
    a.weekdayOfMonth?.weekday === b.weekdayOfMonth?.weekday &&
    a.until === b.until &&
    a.count === b.count
  );
}

const noteParam = zValidator('param', z.object({ noteId: z.uuid() }));

export const reminderRoutes = new Hono<AppEnv>()
  .use(requireUser)
  // Settings are per user and rarely change, so they are plain requests rather than one
  // more synced shape. These routes sit ahead of `/:noteId`.
  .get('/settings', async (c) => {
    const [row] = await db
      .select()
      .from(reminderSettings)
      .where(eq(reminderSettings.userId, c.get('user')!.id));
    return c.json({
      timeZone: row?.timeZone ?? null,
      times: row?.times ?? DEFAULT_REMINDER_TIMES,
      snoozeMinutes:
        snoozeMinutesSchema.safeParse(row?.snoozeMinutes).data ?? DEFAULT_SNOOZE_MINUTES,
    } satisfies ReminderSettings);
  })
  // The Android app's background check: it rings reminders itself, and asks here for the
  // ones set on other devices while it was closed.
  .get('/alarms', async (c) => {
    const rows = await db
      .select({ reminder: reminders, text: notes.searchText })
      .from(reminders)
      .innerJoin(notes, eq(notes.id, reminders.noteId))
      .where(and(eq(reminders.userId, c.get('user')!.id), isNull(notes.deletedAt)));
    const alarms = rows.flatMap(({ reminder, text }) => reminderAlarm(reminder, text) ?? []);
    return c.json({ alarms } satisfies ReminderAlarms);
  })
  .put('/settings', zValidator('json', saveReminderSettingsSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { times, snoozeMinutes, timeZone } = c.req.valid('json');
    await db
      .insert(reminderSettings)
      .values({ userId, timeZone, times, snoozeMinutes })
      .onConflictDoUpdate({ target: reminderSettings.userId, set: { times, snoozeMinutes } });
    return c.json({ ok: true });
  })
  // Where the user is, which is where their floating reminders ring.
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
      // Locked, so a zone change rescheduling the user's reminders is not overwritten by a
      // save that read the old zone.
      const [settings] = await tx
        .select({ timeZone: reminderSettings.timeZone })
        .from(reminderSettings)
        .where(eq(reminderSettings.userId, userId))
        .for('update');
      const [existing] = await tx
        .select()
        .from(reminders)
        .where(and(eq(reminders.noteId, noteId), eq(reminders.userId, userId)));
      // A queued write sent again after the server took it must not work its times out
      // afresh: by then the reminder may have rung, and it would ring a second time.
      if (
        existing &&
        existing.kind === body.kind &&
        existing.startsAt === body.startsAt &&
        existing.timeZone === body.timeZone &&
        existing.floating === body.floating &&
        sameRecurrence(existing.recurrence, body.recurrence) &&
        (existing.snoozedUntil?.getTime() ?? null) === (body.snoozedUntil?.getTime() ?? null)
      ) {
        return undefined;
      }
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
        .onConflictDoUpdate({
          target: reminders.noteId,
          set: values,
          setWhere: eq(reminders.userId, userId),
        });
      return currentTxid(tx);
    });
    if (txid === null) return c.json({ error: 'Note not found' }, 404);
    return c.json({ txid: txid ?? null });
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
