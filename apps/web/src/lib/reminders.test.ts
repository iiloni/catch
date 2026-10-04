import { DEFAULT_REMINDER_TIMES, recurrenceSchema } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  defaultReminderStart,
  describeRecurrence,
  deviceLocalTime,
  formatReminderTime,
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
  it('offers today, tomorrow and a week on', () => {
    expect(quickReminderDays(at(5, 10))).toEqual([
      { label: 'Today', date: '2026-10-05' },
      { label: 'Tomorrow', date: '2026-10-06' },
      { label: 'Next week', date: '2026-10-12' },
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
