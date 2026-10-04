import { DEFAULT_REMINDER_TIMES, type Reminder, recurrenceSchema } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultReminderStart,
  describeRecurrence,
  describeReminder,
  deviceLocalTime,
  formatReminderTime,
  isReminderPast,
  quickReminderDays,
  quickReminderTimes,
} from './reminders';

vi.mock('./collections', () => ({ remindersCollection: {}, write: vi.fn() }));
vi.mock('./api', () => ({ api: {} }));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));

/** A time on this device's clock, whatever zone the tests run in. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);

describe('formatReminderTime', () => {
  const now = at(5, 10);
  const time = (date: Date) =>
    new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date);

  it('names days near today', () => {
    expect(formatReminderTime(at(5, 18), now)).toBe(`Today, ${time(at(5, 18))}`);
    expect(formatReminderTime(at(6, 8), now)).toBe(`Tomorrow, ${time(at(6, 8))}`);
    expect(formatReminderTime(at(4, 8), now)).toBe(`Yesterday, ${time(at(4, 8))}`);
  });

  it('uses the weekday within a week and the date beyond it', () => {
    // In whatever language the machine running the tests speaks.
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(at(8, 9));
    const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
      at(20, 9),
    );
    expect(formatReminderTime(at(8, 9), now)).toBe(`${weekday}, ${time(at(8, 9))}`);
    expect(formatReminderTime(at(20, 9), now)).toBe(`${day}, ${time(at(20, 9))}`);
    expect(formatReminderTime(new Date(2027, 2, 1, 9), now)).toMatch(/2027/);
  });
});

describe('a reminder on a note', () => {
  const now = at(5, 10);
  // A fixed zone, so the times below are instants whatever zone the tests run in.
  const reminder = (changes: Partial<Reminder>): Reminder => ({
    noteId: '0199a0a0-0000-7000-8000-000000000000',
    userId: 'user-1',
    kind: 'time',
    startsAt: deviceLocalTime(at(5, 9)),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    floating: false,
    recurrence: null,
    nextAt: null,
    snoozedUntil: null,
    firedAt: null,
    ...changes,
  });
  const local = (date: Date) => deviceLocalTime(date);

  it('is past once its time went by more than a minute ago, or it has none left', () => {
    const due = (time: Date) => reminder({ nextAt: local(time) });
    expect(isReminderPast(due(at(5, 10, 1)), now)).toBe(false);
    // Within the minute of grace.
    expect(isReminderPast(due(at(5, 10)), now)).toBe(false);
    expect(isReminderPast(due(at(5, 9, 58)), now)).toBe(true);
    expect(isReminderPast(reminder({ nextAt: null }), now)).toBe(true);
    // A snooze still ahead keeps one whose time has gone by.
    expect(isReminderPast(reminder({ nextAt: null, snoozedUntil: at(5, 11) }), now)).toBe(false);
  });

  it('shows when it rings next, else when it last rang, else when it was set for', () => {
    expect(describeReminder(reminder({ nextAt: local(at(5, 18)) }), now)).toBe(
      formatReminderTime(at(5, 18), now),
    );
    expect(
      describeReminder(reminder({ snoozedUntil: at(5, 11), nextAt: local(at(6, 9)) }), now),
    ).toBe(formatReminderTime(at(5, 11), now));
    expect(describeReminder(reminder({ firedAt: at(4, 9) }), now)).toBe(
      formatReminderTime(at(4, 9), now),
    );
    expect(describeReminder(reminder({}), now)).toBe(formatReminderTime(at(5, 9), now));
  });
});

describe('describeRecurrence', () => {
  const repeat = (value: object) => recurrenceSchema.parse({ interval: 1, ...value });

  it('describes how a reminder repeats', () => {
    expect(describeRecurrence(repeat({ frequency: 'daily' }))).toBe('Daily');
    expect(describeRecurrence(repeat({ frequency: 'daily', interval: 3 }))).toBe('Every 3 days');
    expect(describeRecurrence(repeat({ frequency: 'weekly', weekdays: [4, 1] }))).toBe(
      'Weekly on Mon, Thu',
    );
    expect(
      describeRecurrence(
        repeat({ frequency: 'monthly', weekdayOfMonth: { ordinal: 2, weekday: 2 } }),
      ),
    ).toBe('Monthly on the second Tuesday');
    expect(
      describeRecurrence(
        repeat({ frequency: 'monthly', interval: 2, weekdayOfMonth: { ordinal: -1, weekday: 5 } }),
      ),
    ).toBe('Every 2 months on the last Friday');
  });
});

describe('quick choices', () => {
  it('offers today and tomorrow', () => {
    expect(quickReminderDays(at(5, 10))).toEqual([
      { label: 'Today', date: '2026-10-05' },
      { label: 'Tomorrow', date: '2026-10-06' },
    ]);
  });

  it('offers the user’s times in order through the day', () => {
    expect(quickReminderTimes(DEFAULT_REMINDER_TIMES).map((item) => item.time)).toEqual([
      '08:00',
      '13:00',
      '18:00',
    ]);
  });

  it('starts a new reminder at the next quick time still ahead', () => {
    expect(defaultReminderStart(at(5, 10), DEFAULT_REMINDER_TIMES)).toBe('2026-10-05T13:00');
    expect(defaultReminderStart(at(5, 14), DEFAULT_REMINDER_TIMES)).toBe('2026-10-05T18:00');
    expect(defaultReminderStart(at(5, 21), DEFAULT_REMINDER_TIMES)).toBe('2026-10-06T08:00');
  });

  it('reads this device’s clock', () => {
    expect(deviceLocalTime(at(5, 9, 7))).toBe('2026-10-05T09:07');
  });
});
