import { recurrenceSchema } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REMINDER_TIMES,
  describeRecurrence,
  deviceLocalTime,
  formatReminderTime,
  quickReminderTimes,
} from './reminders';

vi.mock('./collections', () => ({ remindersCollection: {}, write: vi.fn() }));
vi.mock('./api', () => ({ api: {} }));

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
    expect(formatReminderTime(at(8, 9), now)).toMatch(/^Thu, /);
    expect(formatReminderTime(at(20, 9), now)).toMatch(/^Oct 20, /);
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

describe('quickReminderTimes', () => {
  it('offers later today while a later time is left', () => {
    expect(quickReminderTimes(at(5, 10), DEFAULT_REMINDER_TIMES)).toEqual([
      { label: 'Later today', startsAt: '2026-10-05T13:00' },
      { label: 'Tomorrow', startsAt: '2026-10-06T08:00' },
      { label: 'Next week', startsAt: '2026-10-12T08:00' },
    ]);
    expect(quickReminderTimes(at(5, 14), DEFAULT_REMINDER_TIMES)[0]).toEqual({
      label: 'Later today',
      startsAt: '2026-10-05T18:00',
    });
  });

  it('starts from tomorrow in the evening', () => {
    expect(quickReminderTimes(at(5, 21), DEFAULT_REMINDER_TIMES).map((item) => item.label)).toEqual(
      ['Tomorrow', 'Next week'],
    );
  });

  it('reads this device’s clock', () => {
    expect(deviceLocalTime(at(5, 9, 7))).toBe('2026-10-05T09:07');
  });
});
