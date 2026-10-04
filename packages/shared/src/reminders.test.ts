import { describe, expect, it } from 'vitest';
import {
  advanceReminder,
  firstPending,
  instantToLocal,
  localTimeSchema,
  localToInstant,
  nextOccurrence,
  pushSubscriptionSchema,
  type Recurrence,
  recurrenceSchema,
  reminderFireTime,
  reminderZone,
} from './reminders';

const repeat = (recurrence: Partial<Recurrence> & Pick<Recurrence, 'frequency'>) =>
  recurrenceSchema.parse({ interval: 1, ...recurrence });

/** The first `count` occurrences of a schedule. */
function take(startsAt: string, recurrence: Recurrence | null, count: number) {
  const found: string[] = [];
  let after: string | null = null;
  while (found.length < count) {
    const next = nextOccurrence({ startsAt, recurrence }, after);
    if (next === null) break;
    found.push(next);
    after = next;
  }
  return found;
}

describe('local times', () => {
  it('accepts real dates and times only', () => {
    expect(localTimeSchema.safeParse('2026-02-28T09:00').success).toBe(true);
    expect(localTimeSchema.safeParse('2024-02-29T23:59').success).toBe(true);
    expect(localTimeSchema.safeParse('2026-02-29T09:00').success).toBe(false);
    expect(localTimeSchema.safeParse('2026-13-01T09:00').success).toBe(false);
    expect(localTimeSchema.safeParse('2026-01-01T24:00').success).toBe(false);
    expect(localTimeSchema.safeParse('2026-01-01 09:00').success).toBe(false);
  });

  it('converts between a wall clock and an instant in a zone', () => {
    expect(localToInstant('2026-07-01T09:00', 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(localToInstant('2026-01-01T09:00', 'Asia/Kolkata').toISOString()).toBe(
      '2026-01-01T03:30:00.000Z',
    );
    expect(instantToLocal(new Date('2026-07-01T13:00:00Z'), 'America/New_York')).toBe(
      '2026-07-01T09:00',
    );
    expect(instantToLocal(new Date('2026-01-01T00:30:00Z'), 'Pacific/Auckland')).toBe(
      '2026-01-01T13:30',
    );
  });

  it('moves a time the clocks skip to after the change', () => {
    // 02:30 does not happen on 2026-03-08 in New York: 02:00 EST becomes 03:00 EDT.
    expect(localToInstant('2026-03-08T02:30', 'America/New_York').toISOString()).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    // Clocks go forward at 02:00 in Sydney on 2026-10-04.
    expect(localToInstant('2026-10-04T02:30', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-03T16:30:00.000Z',
    );
  });

  it('takes the first of a time the clocks show twice', () => {
    // 01:30 happens twice on 2026-11-01 in New York; the first is still daylight time.
    expect(localToInstant('2026-11-01T01:30', 'America/New_York').toISOString()).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });
});

describe('nextOccurrence', () => {
  it('rings once without a recurrence', () => {
    const schedule = { startsAt: '2026-10-05T09:00', recurrence: null };
    expect(nextOccurrence(schedule, null)).toBe('2026-10-05T09:00');
    expect(nextOccurrence(schedule, '2026-10-05T08:59')).toBe('2026-10-05T09:00');
    expect(nextOccurrence(schedule, '2026-10-05T09:00')).toBeNull();
  });

  it('repeats every few days', () => {
    expect(take('2026-12-30T08:00', repeat({ frequency: 'daily', interval: 2 }), 3)).toEqual([
      '2026-12-30T08:00',
      '2027-01-01T08:00',
      '2027-01-03T08:00',
    ]);
  });

  it('repeats on chosen weekdays, starting from the start', () => {
    // 2026-10-07 is a Wednesday. Monday of that week is before the start.
    const recurrence = repeat({ frequency: 'weekly', weekdays: [5, 1] });
    expect(take('2026-10-07T09:00', recurrence, 4)).toEqual([
      '2026-10-09T09:00',
      '2026-10-12T09:00',
      '2026-10-16T09:00',
      '2026-10-19T09:00',
    ]);
  });

  it('repeats on the start weekday every other week', () => {
    expect(take('2026-10-07T09:00', repeat({ frequency: 'weekly', interval: 2 }), 3)).toEqual([
      '2026-10-07T09:00',
      '2026-10-21T09:00',
      '2026-11-04T09:00',
    ]);
  });

  it('falls on the last day of months too short for the date', () => {
    expect(take('2027-01-31T10:00', repeat({ frequency: 'monthly' }), 4)).toEqual([
      '2027-01-31T10:00',
      '2027-02-28T10:00',
      '2027-03-31T10:00',
      '2027-04-30T10:00',
    ]);
  });

  it('repeats on the nth weekday of the month', () => {
    const second = repeat({ frequency: 'monthly', weekdayOfMonth: { ordinal: 2, weekday: 2 } });
    expect(take('2026-10-01T18:00', second, 3)).toEqual([
      '2026-10-13T18:00',
      '2026-11-10T18:00',
      '2026-12-08T18:00',
    ]);
    const last = repeat({ frequency: 'monthly', weekdayOfMonth: { ordinal: -1, weekday: 5 } });
    expect(take('2026-10-31T18:00', last, 3)).toEqual([
      '2026-11-27T18:00',
      '2026-12-25T18:00',
      '2027-01-29T18:00',
    ]);
  });

  it('keeps a leap day reminder at the end of February', () => {
    expect(take('2024-02-29T12:00', repeat({ frequency: 'yearly' }), 5).at(-1)).toBe(
      '2028-02-29T12:00',
    );
    expect(take('2024-02-29T12:00', repeat({ frequency: 'yearly' }), 2)[1]).toBe(
      '2025-02-28T12:00',
    );
  });

  it('stops after a count or a date', () => {
    expect(take('2026-10-05T09:00', repeat({ frequency: 'daily', count: 2 }), 5)).toEqual([
      '2026-10-05T09:00',
      '2026-10-06T09:00',
    ]);
    expect(
      take('2026-10-05T09:00', repeat({ frequency: 'daily', until: '2026-10-07' }), 5),
    ).toEqual(['2026-10-05T09:00', '2026-10-06T09:00', '2026-10-07T09:00']);
  });

  it('finds an occurrence far from the start', () => {
    expect(
      nextOccurrence(
        { startsAt: '2000-01-01T07:00', recurrence: repeat({ frequency: 'daily' }) },
        '2026-10-05T07:00',
      ),
    ).toBe('2026-10-06T07:00');
  });
});

describe('reminder timing', () => {
  const daily = { startsAt: '2026-10-01T09:00', recurrence: repeat({ frequency: 'daily' }) };

  it('reads a floating reminder where the user is and a fixed one where it was made', () => {
    expect(reminderZone({ floating: true, timeZone: 'Europe/London' }, 'Asia/Tokyo')).toBe(
      'Asia/Tokyo',
    );
    expect(reminderZone({ floating: true, timeZone: 'Europe/London' }, null)).toBe('Europe/London');
    expect(reminderZone({ floating: false, timeZone: 'Europe/London' }, 'Asia/Tokyo')).toBe(
      'Europe/London',
    );
  });

  it('waits for the first occurrence that has not passed', () => {
    const now = new Date('2026-10-05T13:00:30Z'); // 09:00:30 in New York
    expect(firstPending(daily, 'America/New_York', now)).toBe('2026-10-05T09:00');
    expect(firstPending(daily, 'Europe/London', now)).toBe('2026-10-06T09:00');
    expect(
      firstPending({ startsAt: '2026-10-01T09:00', recurrence: null }, 'Europe/London', now),
    ).toBeNull();
  });

  it('rings at the snooze before the occurrence', () => {
    const snoozedUntil = new Date('2026-10-05T10:00:00Z');
    expect(reminderFireTime({ nextAt: '2026-10-06T09:00', snoozedUntil }, 'UTC')).toBe(
      snoozedUntil,
    );
    expect(
      reminderFireTime({ nextAt: '2026-10-06T09:00', snoozedUntil: null }, 'UTC')?.toISOString(),
    ).toBe('2026-10-06T09:00:00.000Z');
    expect(reminderFireTime({ nextAt: null, snoozedUntil: null }, 'UTC')).toBeNull();
  });

  it('moves on to the next occurrence once it has rung', () => {
    const now = new Date('2026-10-05T09:00:05Z');
    expect(
      advanceReminder({ ...daily, nextAt: '2026-10-05T09:00', snoozedUntil: null }, 'UTC', now),
    ).toEqual({ nextAt: '2026-10-06T09:00', snoozedUntil: null });
    expect(
      advanceReminder(
        {
          startsAt: '2026-10-05T09:00',
          recurrence: null,
          nextAt: '2026-10-05T09:00',
          snoozedUntil: null,
        },
        'UTC',
        now,
      ),
    ).toEqual({ nextAt: null, snoozedUntil: null });
  });

  it('skips the occurrences missed while nothing could ring', () => {
    const now = new Date('2026-10-08T15:00:00Z');
    expect(
      advanceReminder({ ...daily, nextAt: '2026-10-05T09:00', snoozedUntil: null }, 'UTC', now),
    ).toEqual({ nextAt: '2026-10-09T09:00', snoozedUntil: null });
  });

  it('spends a snooze without skipping an occurrence still ahead', () => {
    const now = new Date('2026-10-05T10:00:00Z');
    expect(
      advanceReminder({ ...daily, nextAt: '2026-10-06T09:00', snoozedUntil: now }, 'UTC', now),
    ).toEqual({ nextAt: '2026-10-06T09:00', snoozedUntil: null });
  });
});

describe('what the server accepts', () => {
  it('turns away an end date the calendar does not have', () => {
    const until = (value: string) =>
      recurrenceSchema.safeParse({ frequency: 'daily', interval: 1, until: value }).success;
    expect(until('2028-02-29')).toBe(true);
    expect(until('2026-02-31')).toBe(false);
    expect(until('2026-13-01')).toBe(false);
  });

  it('takes only push keys a browser could have made', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
    const keys = { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) };
    const accepts = (changed: object) =>
      pushSubscriptionSchema.safeParse({ endpoint, keys: { ...keys, ...changed } }).success;
    expect(accepts({})).toBe(true);
    expect(accepts({ p256dh: 'BPk' })).toBe(false);
    expect(accepts({ auth: `${keys.auth}==` })).toBe(false);
  });
});
