import { advanceReminder, reminderFireTime, reminderZone } from '@catch/shared';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { isRestoring } from '../backups/service';
import { db } from '../db/client';
import { notes, reminderSettings, reminders } from '../db/schema';
import { notifyUser } from '../push';
import { reminderMessage } from './message';

/**
 * A reminder that comes due while the server is off rings when it starts again, unless it
 * is older than this: a day-old "leave now" is noise.
 */
const LATE_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 10_000;
const BATCH = 200;

/**
 * Rings every reminder that has come due and moves each on to what it waits for next. A
 * reminder is moved on before its notification is sent, so a crash in between loses that
 * one ring rather than repeating it on every start.
 */
export async function fireDueReminders(now = new Date()) {
  const due = await db
    .select({
      reminder: reminders,
      text: notes.searchText,
      userTimeZone: reminderSettings.timeZone,
    })
    .from(reminders)
    .innerJoin(notes, eq(notes.id, reminders.noteId))
    .leftJoin(reminderSettings, eq(reminderSettings.userId, reminders.userId))
    // A note in the trash keeps its reminder as it is: restored within a day of the time, it
    // still rings; later, it moves on silently.
    .where(and(lte(reminders.fireAt, now), isNull(notes.deletedAt)))
    .orderBy(asc(reminders.fireAt))
    .limit(BATCH);

  for (const { reminder, text, userTimeZone } of due) {
    if (!reminder.fireAt) continue;
    const zone = reminderZone(reminder, userTimeZone);
    const next = advanceReminder(reminder, zone, now);
    let fireAt = reminderFireTime(next, zone);
    // Around a clock change a later wall clock time can be an earlier instant.
    if (fireAt && fireAt <= now) fireAt = new Date(now.getTime() + 60_000);
    const rings = now.getTime() - reminder.fireAt.getTime() <= LATE_MS;
    const claimed = await db
      .update(reminders)
      .set({ ...next, fireAt, ...(rings ? { firedAt: now } : {}) })
      // Unchanged since it was read: a save in between has already rescheduled it.
      .where(and(eq(reminders.noteId, reminder.noteId), eq(reminders.fireAt, reminder.fireAt)))
      .returning({ noteId: reminders.noteId });
    if (claimed.length === 0 || !rings) continue;
    await notifyUser(reminder.userId, reminderMessage(reminder.noteId, text)).catch(
      (error: unknown) => console.error('Could not send a reminder', error),
    );
  }
}

/** Checks for due reminders every few seconds while the server runs. */
export function startReminderSchedule() {
  let running = false;
  const tick = async () => {
    // A restore replaces the table under a half-finished pass.
    if (running || isRestoring()) return;
    running = true;
    try {
      await fireDueReminders();
    } catch (error) {
      console.error('Could not check reminders', error);
    } finally {
      running = false;
    }
  };
  setInterval(tick, TICK_MS).unref();
  void tick();
}
