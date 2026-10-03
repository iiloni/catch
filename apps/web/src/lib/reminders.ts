import {
  firstPending,
  instantToLocal,
  type Note,
  type Recurrence,
  type Reminder,
  reminderFireTime,
  reminderZone,
} from '@catch/shared';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from './api';
import { remindersCollection, write } from './collections';
import { usePersistentState } from './storage';
import { createStore } from './store';

/** The note whose reminder is being set, in the sheet `ReminderSheet` shows. */
export const reminderSheet = createStore<string | null>(null);

export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The wall clock on this device at an instant, as reminders store times. */
export const deviceLocalTime = (instant: Date) => instantToLocal(instant, deviceTimeZone());

export type ReminderInput = Pick<Reminder, 'startsAt' | 'timeZone' | 'floating' | 'recurrence'>;

/**
 * Sets or replaces a note's reminder. The server works out what it waits for; the same sum
 * is done here so the note shows its reminder at once, and offline.
 */
export function setReminder(note: Pick<Note, 'id' | 'userId'>, input: ReminderInput) {
  const zone = reminderZone(input, deviceTimeZone());
  const changes = { ...input, nextAt: firstPending(input, zone, new Date()), snoozedUntil: null };
  return write(() => {
    if (remindersCollection.has(note.id)) {
      remindersCollection.update(note.id, (draft) => Object.assign(draft, changes));
    } else {
      remindersCollection.insert({
        ...changes,
        noteId: note.id,
        userId: note.userId,
        kind: 'time',
        firedAt: null,
      });
    }
  });
}

export function removeReminder(noteId: string) {
  const reminder = remindersCollection.get(noteId);
  if (!reminder) return;
  write(() => remindersCollection.delete(noteId));
  toast('Reminder removed', {
    action: {
      label: 'Undo',
      onClick: () => setReminder({ id: noteId, userId: reminder.userId }, reminder),
    },
  });
}

/** Puts a reminder off until `until`, leaving its schedule as it is. */
export function snoozeReminder(noteId: string, until: Date) {
  return write(() =>
    remindersCollection.update(noteId, (draft) => {
      draft.snoozedUntil = until;
    }),
  );
}

/** When a reminder next rings on this device's clock, or null when it has none left. */
export function reminderTime(reminder: Reminder): Date | null {
  return reminderFireTime(reminder, reminderZone(reminder, deviceTimeZone()));
}

/** A reminder with nothing left to ring for: it shows struck through until it is reset. */
export const isReminderPast = (reminder: Reminder, now = new Date()) => {
  const time = reminderTime(reminder);
  return time === null || time.getTime() < now.getTime() - 60_000;
};

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const yearFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** A time of day (`HH:MM`) as this device writes times: "8:00 AM" or "08:00". */
export function formatTimeOfDay(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return timeFormat.format(new Date(2000, 0, 1, hour, minute));
}

/** "Today, 9:00", "Tomorrow, 9:00", "Fri, 9:00", "Oct 12, 9:00". */
export function formatReminderTime(time: Date, now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const days = (time.getTime() - now.getTime()) / 86_400_000;
  const day = sameDay(time, now)
    ? 'Today'
    : sameDay(time, tomorrow)
      ? 'Tomorrow'
      : sameDay(time, yesterday)
        ? 'Yesterday'
        : days > 0 && days < 6
          ? weekdayFormat.format(time)
          : time.getFullYear() === now.getFullYear()
            ? dayFormat.format(time)
            : yearFormat.format(time);
  return `${day}, ${timeFormat.format(time)}`;
}

/** The time a reminder shows: when it rings next, or when it last did. */
export function describeReminder(reminder: Reminder, now = new Date()) {
  const time =
    reminderTime(reminder) ??
    reminder.firedAt ??
    reminderFireTime(
      { nextAt: reminder.startsAt, snoozedUntil: null },
      reminderZone(reminder, deviceTimeZone()),
    );
  return time ? formatReminderTime(time, now) : '';
}

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const ORDINALS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
};
export const ordinalName = (ordinal: number) => ORDINALS[ordinal] ?? '';

const UNITS = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;
const NAMES = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' } as const;

/** "Daily", "Every 2 weeks on Mon, Thu", "Monthly on the second Tuesday". */
export function describeRecurrence(recurrence: Recurrence) {
  const { frequency, interval } = recurrence;
  let text = interval === 1 ? NAMES[frequency] : `Every ${interval} ${UNITS[frequency]}s`;
  if (frequency === 'weekly' && recurrence.weekdays.length > 0) {
    const days = [...recurrence.weekdays].sort((a, b) => a - b);
    text += ` on ${days.map((day) => WEEKDAYS[day]?.slice(0, 3)).join(', ')}`;
  }
  if (frequency === 'monthly' && recurrence.weekdayOfMonth) {
    const { ordinal, weekday } = recurrence.weekdayOfMonth;
    text += ` on the ${ordinalName(ordinal)} ${WEEKDAYS[weekday]}`;
  }
  return text;
}

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const reminderTimesSchema = z.object({
  morning: timeOfDay,
  afternoon: timeOfDay,
  evening: timeOfDay,
});
export type ReminderTimes = z.infer<typeof reminderTimesSchema>;
export const DEFAULT_REMINDER_TIMES: ReminderTimes = {
  morning: '08:00',
  afternoon: '13:00',
  evening: '18:00',
};

/** The times of day the quick choices use, kept on this device. */
export function useReminderTimes() {
  return usePersistentState('catch-reminder-times', reminderTimesSchema, DEFAULT_REMINDER_TIMES);
}

const dateOf = (date: Date) => deviceLocalTime(date).slice(0, 10);

/** One-tap times for a new reminder, as Keep offered: later today, tomorrow, next week. */
export function quickReminderTimes(now: Date, times: ReminderTimes) {
  const today = dateOf(now);
  const nowTime = deviceLocalTime(now).slice(11);
  const day = (offset: number) =>
    dateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12));
  const later = [times.afternoon, times.evening].find((time) => time > nowTime);
  return [
    ...(later ? [{ label: 'Later today', startsAt: `${today}T${later}` }] : []),
    { label: 'Tomorrow', startsAt: `${day(1)}T${times.morning}` },
    { label: 'Next week', startsAt: `${day(7)}T${times.morning}` },
  ];
}

/**
 * Tells the server which zone this device is in, once, and again when it moves, so floating
 * reminders ring by the clock where the user is.
 */
export async function reportDeviceTimeZone(userId: string) {
  const key = `catch-time-zone:${userId}`;
  const timeZone = deviceTimeZone();
  const reported = localStorage.getItem(key);
  if (reported === timeZone) return;
  try {
    await api.reportTimeZone({ timeZone, changed: reported !== null });
    localStorage.setItem(key, timeZone);
  } catch {
    // Offline, or a server that is restarting: the next launch or return to the app tries again.
  }
}
