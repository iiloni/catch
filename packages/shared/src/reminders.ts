import { z } from 'zod';
import { isTimeZone } from './backups';

/**
 * Reminders (ADR 0018). A note has at most one, keyed by the note's id. Its times are wall
 * clock times (`YYYY-MM-DDTHH:MM`) rather than instants: a floating reminder is read in the
 * zone the user is in when it comes due, a fixed one in the zone it was made in.
 */

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function isCalendarDate(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return false;
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** A wall clock date and time to the minute, in no particular zone. */
export const localTimeSchema = z.string().refine((value) => {
  const parts = LOCAL_TIME.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return (
    year >= 1970 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59
  );
}, 'Use YYYY-MM-DDTHH:MM');

export const timeZoneSchema = z.string().max(64).refine(isTimeZone, 'Unknown time zone');

/** Days of the week as `Date.getDay()` numbers them: 0 is Sunday. */
const weekdaySchema = z.number().int().min(0).max(6);

export const recurrenceSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  /** Every `interval` days, weeks, months or years. */
  interval: z.number().int().min(1).max(999),
  /** Weekly only: the days it comes due. Empty means the start's weekday. */
  weekdays: z.array(weekdaySchema).max(7).default([]),
  /**
   * Monthly only: the "second Tuesday" kind, where -1 is the last one in the month. Without
   * it a monthly reminder falls on the start's day of the month, or the last day of a month
   * too short to have it.
   */
  weekdayOfMonth: z
    .object({
      ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]),
      weekday: weekdaySchema,
    })
    .nullable()
    .default(null),
  /** The last date (`YYYY-MM-DD`) it may come due on. */
  until: z
    .string()
    .refine(isCalendarDate, 'Use a date on the calendar, as YYYY-MM-DD')
    .nullable()
    .default(null),
  /** How many times it comes due, counted from the start. */
  count: z.number().int().min(1).max(9999).nullable().default(null),
});
export type Recurrence = z.infer<typeof recurrenceSchema>;

/**
 * `time` is the only kind today. A reminder for a place (which only the Android app could
 * watch for) would be another kind with fields of its own.
 */
export const reminderKindSchema = z.enum(['time']);

export const reminderSchema = z.object({
  noteId: z.uuid(),
  userId: z.string(),
  kind: reminderKindSchema,
  /** When it first comes due, and the time of day it repeats at. */
  startsAt: localTimeSchema,
  /** The zone it was made in. A fixed reminder is read in it; a floating one falls back to it. */
  timeZone: timeZoneSchema,
  /** Follows the user: 9:00 is 9:00 wherever they are. */
  floating: z.boolean(),
  recurrence: recurrenceSchema.nullable(),
  /** The occurrence it is waiting for, or null once the last one has passed. */
  nextAt: localTimeSchema.nullable(),
  /** Put off until this instant, whatever `nextAt` says. */
  snoozedUntil: z.coerce.date().nullable(),
  /** When the server last sent it. */
  firedAt: z.coerce.date().nullable(),
});
export type Reminder = z.infer<typeof reminderSchema>;

/** What a client sets. The server works out `nextAt` and owns `firedAt`. */
export const saveReminderSchema = reminderSchema.pick({
  kind: true,
  startsAt: true,
  timeZone: true,
  floating: true,
  recurrence: true,
  snoozedUntil: true,
});
export type SaveReminder = z.infer<typeof saveReminderSchema>;

export type ReminderSchedule = Pick<Reminder, 'startsAt' | 'recurrence'>;

/**
 * The zone a device is in. `changed` is false when the device is only saying where it is
 * (its first report), which must not move a user whose other device has travelled.
 */
export const reportTimeZoneSchema = z.object({ timeZone: timeZoneSchema, changed: z.boolean() });
export type ReportTimeZone = z.infer<typeof reportTimeZoneSchema>;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** The times of day the quick choices (Morning, Afternoon, Evening) stand for, as `HH:MM`. */
export const reminderTimesSchema = z.object({
  morning: timeOfDaySchema,
  afternoon: timeOfDaySchema,
  evening: timeOfDaySchema,
});
export type ReminderTimes = z.infer<typeof reminderTimesSchema>;

export const DEFAULT_REMINDER_TIMES: ReminderTimes = {
  morning: '08:00',
  afternoon: '13:00',
  evening: '18:00',
};

/** A user's reminder settings. Server state fetched by plain requests, not a synced shape. */
export const reminderSettingsSchema = z.object({
  timeZone: timeZoneSchema.nullable(),
  times: reminderTimesSchema,
});
export type ReminderSettings = z.infer<typeof reminderSettingsSchema>;

/** The device's zone comes along for a user the server has not seen a zone for yet. */
export const saveReminderTimesSchema = z.object({
  times: reminderTimesSchema,
  timeZone: timeZoneSchema,
});
export type SaveReminderTimes = z.infer<typeof saveReminderTimesSchema>;

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseLocal(value: string): Parts {
  const parts = LOCAL_TIME.exec(value);
  if (!parts) throw new Error(`Not a local time: ${value}`);
  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return { year, month, day, hour, minute };
}

const formatLocal = ({ year, month, day, hour, minute }: Parts) =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;

/** The same wall clock reading as if it were UTC, to do calendar arithmetic with. */
const asUtc = ({ year, month, day, hour, minute }: Parts) =>
  Date.UTC(year, month - 1, day, hour, minute);

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The wall clock at an instant in a time zone. */
export function instantToLocal(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year?.padStart(4, '0')}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant a wall clock shows a time in a zone. A time the clocks skip (spring forward)
 * becomes the same distance after the change, so 02:30 rings at 03:30; a time they show
 * twice (fall back) is the first of the two.
 */
export function localToInstant(local: string, timeZone: string): Date {
  const wall = asUtc(parseLocal(local));
  // The zone's offset on either side of any change near this time.
  const offsetAt = (instant: number) =>
    asUtc(parseLocal(instantToLocal(new Date(instant), timeZone))) - instant;
  const before = wall - offsetAt(wall - DAY_MS);
  const after = wall - offsetAt(wall + DAY_MS);
  const shows = (instant: number) => instantToLocal(new Date(instant), timeZone) === local;
  const valid = [before, after].filter(shows);
  return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(before, after));
}

/** The date of the nth (or, for -1, last) `weekday` of a month. */
function weekdayOfMonth(year: number, month: number, ordinal: number, weekday: number) {
  if (ordinal === -1) {
    const last = daysInMonth(year, month);
    const lastWeekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
    return last - ((lastWeekday - weekday + 7) % 7);
  }
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (ordinal - 1) * 7;
}

/** Enough for a daily reminder to run for centuries, and a bound on a hostile schedule. */
const MAX_STEPS = 200_000;

/** Every time a schedule comes due, in order, as wall clock times. */
function* occurrences({ startsAt, recurrence }: ReminderSchedule): Generator<string> {
  const start = parseLocal(startsAt);
  if (!recurrence) {
    yield startsAt;
    return;
  }
  const { frequency, interval } = recurrence;
  const startDay = Date.UTC(start.year, start.month - 1, start.day);
  const at = (year: number, month: number, day: number) =>
    formatLocal({ ...start, year, month, day });
  const onDay = (dayMs: number) => {
    const date = new Date(dayMs);
    return at(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  };

  function* candidates(recurrence: Recurrence): Generator<string> {
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (frequency === 'daily') {
        yield onDay(startDay + step * interval * DAY_MS);
      } else if (frequency === 'weekly') {
        const weekdays =
          recurrence.weekdays.length > 0
            ? [...new Set(recurrence.weekdays)].sort((a, b) => a - b)
            : [new Date(startDay).getUTCDay()];
        const sunday = startDay - new Date(startDay).getUTCDay() * DAY_MS;
        for (const weekday of weekdays) {
          yield onDay(sunday + (step * interval * 7 + weekday) * DAY_MS);
        }
      } else if (frequency === 'monthly') {
        const index = start.year * 12 + (start.month - 1) + step * interval;
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        const nth = recurrence.weekdayOfMonth;
        yield at(
          year,
          month,
          nth
            ? weekdayOfMonth(year, month, nth.ordinal, nth.weekday)
            : Math.min(start.day, daysInMonth(year, month)),
        );
      } else {
        const year = start.year + step * interval;
        yield at(year, start.month, Math.min(start.day, daysInMonth(year, start.month)));
      }
    }
  }

  let made = 0;
  for (const occurrence of candidates(recurrence)) {
    // A week or month can hold days ahead of the start.
    if (occurrence < startsAt) continue;
    if (recurrence.until && occurrence.slice(0, 10) > recurrence.until) return;
    if (recurrence.count !== null && made >= recurrence.count) return;
    made += 1;
    yield occurrence;
  }
}

/** The first time a schedule comes due later than `after`, or null when none is left. */
export function nextOccurrence(schedule: ReminderSchedule, after: string | null): string | null {
  for (const occurrence of occurrences(schedule)) {
    if (after === null || occurrence > after) return occurrence;
  }
  return null;
}

/**
 * How many of a counted repeat's times are still to come, the one it waits for included,
 * or null for a reminder that is not counted. A schedule edited to start at its next time
 * carries this on as its count, so the edit does not start the count again.
 */
export function remainingCount(reminder: ReminderSchedule & Pick<Reminder, 'nextAt'>) {
  const count = reminder.recurrence?.count ?? null;
  if (count === null) return null;
  if (!reminder.nextAt) return 0;
  let past = 0;
  for (const occurrence of occurrences(reminder)) {
    if (occurrence >= reminder.nextAt) break;
    past += 1;
  }
  return count - past;
}

/** The zone a reminder is read in, given the zone its user was last seen in. */
export function reminderZone(
  reminder: Pick<Reminder, 'floating' | 'timeZone'>,
  userTimeZone: string | null | undefined,
) {
  return reminder.floating ? (userTimeZone ?? reminder.timeZone) : reminder.timeZone;
}

/** A minute of grace, so a reminder set for the minute now showing still rings. */
const GRACE_MS = 60_000;

/**
 * The occurrence a newly saved schedule waits for: its first that has not passed. Passed is
 * a matter of instants: when clocks go back a wall clock time comes round twice, and one
 * read as text would still look ahead after it had rung.
 */
export function firstPending(schedule: ReminderSchedule, timeZone: string, now: Date) {
  const passed = now.getTime() - GRACE_MS;
  // Text and instants only disagree within a clock change, so everything a day or more
  // behind is skipped as text, which a long-running repeat has thousands of.
  const wellBehind = instantToLocal(new Date(passed - DAY_MS), timeZone);
  for (const occurrence of occurrences(schedule)) {
    if (occurrence <= wellBehind) continue;
    if (localToInstant(occurrence, timeZone).getTime() > passed) return occurrence;
  }
  return null;
}

type Timing = Pick<Reminder, 'nextAt' | 'snoozedUntil'>;

/** The instant a reminder next rings, or null when it has nothing left to ring for. */
export function reminderFireTime(reminder: Timing, timeZone: string): Date | null {
  if (reminder.snoozedUntil) return reminder.snoozedUntil;
  return reminder.nextAt ? localToInstant(reminder.nextAt, timeZone) : null;
}

/**
 * What a reminder waits for once it has rung at `now`: a snooze is spent, and the occurrence
 * it rang for gives way to the first one still ahead. Occurrences missed in between (while
 * the server was off, say) are skipped rather than rung one after another.
 */
export function advanceReminder(
  reminder: ReminderSchedule & Timing,
  timeZone: string,
  now: Date,
): Timing {
  const { nextAt } = reminder;
  if (!nextAt || localToInstant(nextAt, timeZone) > now) return { nextAt, snoozedUntil: null };
  const nowLocal = instantToLocal(now, timeZone);
  return {
    nextAt: nextOccurrence(reminder, nowLocal > nextAt ? nowLocal : nextAt),
    snoozedUntil: null,
  };
}

/**
 * A push subscription as `PushSubscription.toJSON()` gives it: its keys are unpadded
 * base64url, an uncompressed P-256 point (65 bytes) and a 16 byte secret. Anything else
 * could never be encrypted to.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const removePushSubscriptionSchema = pushSubscriptionSchema.pick({ endpoint: true });

export const pushKeySchema = z.object({ publicKey: z.string() });
export type PushKey = z.infer<typeof pushKeySchema>;

export const testPushResponseSchema = z.object({ sent: z.number().int().nonnegative() });
export type TestPushResponse = z.infer<typeof testPushResponseSchema>;

/** What a push message carries to the service worker. */
export const pushMessageSchema = z.object({
  type: z.enum(['reminder', 'test']),
  noteId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
});
export type PushMessage = z.infer<typeof pushMessageSchema>;
