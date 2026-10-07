import {
  advanceReminder,
  reminderFireTime,
  reminderZone,
  VAULT_REMINDER_TEXT,
} from '@catch/shared';
import { and, asc, eq, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { isRestoring } from '../backups/service';
import { db } from '../db/client';
import { notes, reminderSettings, reminders, vaultNotes } from '../db/schema';
import { notifyUser } from '../push';
import { reminderMessage } from './message';

/**
 * A reminder that comes due while the server is off rings when it starts again, unless it
 * is older than this: a day-old "leave now" is noise.
 */
const LATE_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 10_000;
const BATCH = 200;
/** A stop for a pass that somehow keeps finding the same rows due. */
const MAX_BATCHES = 500;

/**
 * Rings every reminder that has come due and moves each on to what it waits for next. A
 * reminder is moved on before its notification is sent, so a crash in between loses that
 * one ring rather than repeating it on every start.
 */
export async function fireDueReminders(now = new Date()) {
  // Everything due is worked through in this pass: left for later ticks, the end of a long
  // backlog would cross the day after which a reminder no longer rings.
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    if ((await fireBatch(now)) < BATCH) return;
  }
}

async function fireBatch(now: Date) {
  const due = await db
    .select({
      reminder: reminders,
      text: notes.searchText,
      sealed: vaultNotes.id,
      userTimeZone: reminderSettings.timeZone,
    })
    .from(reminders)
    .leftJoin(notes, and(eq(notes.id, reminders.noteId), eq(notes.userId, reminders.userId)))
    .leftJoin(
      vaultNotes,
      and(eq(vaultNotes.id, reminders.noteId), eq(vaultNotes.userId, reminders.userId)),
    )
    .leftJoin(reminderSettings, eq(reminderSettings.userId, reminders.userId))
    // A note in the trash keeps its reminder as it is: restored within a day of the time, it
    // still rings; later, it moves on silently. The trash of the vault is sealed from the
    // server, so a device takes a vault note's reminder off when it trashes the note.
    .where(
      and(
        lte(reminders.fireAt, now),
        or(and(isNotNull(notes.id), isNull(notes.deletedAt)), isNotNull(vaultNotes.id)),
      ),
    )
    .orderBy(asc(reminders.fireAt))
    .limit(BATCH);

  for (const { reminder: read, text, sealed, userTimeZone } of due) {
    const rings = await db.transaction(async (tx) => {
      // Read again under a lock, and moved on from what is there now: a save since the
      // batch was read may have changed the schedule and left its time as it was, and
      // moving on from the old one would write the old schedule's end over the new one.
      const [reminder] = await tx
        .select()
        .from(reminders)
        .where(and(eq(reminders.noteId, read.noteId), lte(reminders.fireAt, now)))
        .for('update');
      if (!reminder?.fireAt) return false;
      const zone = reminderZone(reminder, userTimeZone);
      const next = advanceReminder(reminder, zone, now);
      let fireAt = reminderFireTime(next, zone);
      // Around a clock change a later wall clock time can be an earlier instant.
      if (fireAt && fireAt <= now) fireAt = new Date(now.getTime() + 60_000);
      const rings = now.getTime() - reminder.fireAt.getTime() <= LATE_MS;
      await tx
        .update(reminders)
        .set({ ...next, fireAt, ...(rings ? { firedAt: now } : {}) })
        .where(eq(reminders.noteId, reminder.noteId));
      return rings;
    });
    if (!rings) continue;
    // The server cannot read a vault note, so its notification only says there is one.
    const words = sealed ? VAULT_REMINDER_TEXT : (text ?? '');
    await notifyUser(read.userId, reminderMessage(read.noteId, words)).catch((error: unknown) =>
      console.error('Could not send a reminder', error),
    );
  }
  return due.length;
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
