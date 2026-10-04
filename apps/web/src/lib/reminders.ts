import {
  DEFAULT_REMINDER_TIMES,
  firstPending,
  instantToLocal,
  type Note,
  type Recurrence,
  type Reminder,
  type ReminderTimes,
  reminderFireTime,
  reminderTimesSchema,
  reminderZone,
} from '@catch/shared';
import { toast } from 'sonner';
import { api } from './api';
import { getSignedInUser } from './auth';
import { remindersCollection, write } from './collections';
import { createStore } from './store';

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

const timesKey = () => `catch-reminder-times:${getSignedInUser()?.id ?? ''}`;
/** Set while a change made on this device has not reached the server. */
const unsentKey = () => `${timesKey()}:unsent`;

function cachedTimes(): ReminderTimes {
  try {
    const parsed = reminderTimesSchema.safeParse(
      JSON.parse(localStorage.getItem(timesKey()) ?? ''),
    );
    if (parsed.success) return parsed.data;
  } catch {
    // Nothing cached yet.
  }
  return DEFAULT_REMINDER_TIMES;
}

const reminderTimes = createStore<ReminderTimes>(cachedTimes());

let sending: Promise<void> = Promise.resolve();

/** One after another, so the server ends on the last change, and only it clears the flag. */
function sendReminderTimes() {
  sending = sending.then(async () => {
    const times = reminderTimes.get();
    try {
      await api.saveReminderTimes({ times, timeZone: deviceTimeZone() });
      if (reminderTimes.get() === times) localStorage.removeItem(unsentKey());
    } catch {
      // Offline: `syncReminderSettings` sends it at the next launch or return to the app.
    }
  });
  return sending;
}

/** The quick times belong to the user and follow them to every device. */
export function setReminderTimes(times: ReminderTimes) {
  reminderTimes.set(times);
  localStorage.setItem(timesKey(), JSON.stringify(times));
  localStorage.setItem(unsentKey(), 'true');
  void sendReminderTimes();
}

/**
 * The times of day the quick choices (Morning, Afternoon, Evening) stand for. They are kept
 * on the server and cached here, so the choices are there offline.
 */
export function useReminderTimes(): [ReminderTimes, (times: ReminderTimes) => void] {
  return [reminderTimes.use(), setReminderTimes];
}

const dateOf = (date: Date) => deviceLocalTime(date).slice(0, 10);

/** The days a reminder is usually for, as dates on this device's calendar. */
export function quickReminderDays(now: Date) {
  const day = (offset: number) =>
    dateOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12));
  return [
    { label: 'Today', date: day(0) },
    { label: 'Tomorrow', date: day(1) },
    { label: 'Next week', date: day(7) },
  ];
}

/** The user's quick times, in order through the day. */
export function quickReminderTimes(times: ReminderTimes) {
  return [
    { label: 'Morning', time: times.morning },
    { label: 'Afternoon', time: times.afternoon },
    { label: 'Evening', time: times.evening },
  ];
}

/** The first quick day and time still ahead: what a new reminder starts as. */
export function defaultReminderStart(now: Date, times: ReminderTimes) {
  const nowTime = deviceLocalTime(now).slice(11);
  // Nothing makes Morning come before Evening in a user's settings.
  const later = quickReminderTimes(times)
    .sort((a, b) => a.time.localeCompare(b.time))
    .find((option) => option.time > nowTime);
  const [today, tomorrow] = quickReminderDays(now);
  return later ? `${today?.date}T${later.time}` : `${tomorrow?.date}T${times.morning}`;
}

/**
 * Run at launch and when the app comes back into view. Tells the server which zone this
 * device is in, once and again when it moves, so floating reminders ring by the clock where
 * the user is; and brings the quick times in line with the server's.
 */
export async function syncReminderSettings(userId: string) {
  const zoneKey = `catch-time-zone:${userId}`;
  const timeZone = deviceTimeZone();
  const reported = localStorage.getItem(zoneKey);
  try {
    if (reported !== timeZone) {
      await api.reportTimeZone({ timeZone, changed: reported !== null });
      localStorage.setItem(zoneKey, timeZone);
    }
    if (localStorage.getItem(unsentKey()) === 'true') {
      await sendReminderTimes();
      return;
    }
    const { times } = await api.reminderSettings();
    // A change made here while the request was out is newer than its answer.
    if (localStorage.getItem(unsentKey()) === 'true') return;
    reminderTimes.set(times);
    localStorage.setItem(timesKey(), JSON.stringify(times));
  } catch {
    // Offline, or a server that is restarting: the next launch or return tries again.
  }
}
