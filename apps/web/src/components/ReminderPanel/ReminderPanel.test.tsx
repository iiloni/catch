import type { Reminder } from '@catch/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatTimeOfDay, removeReminder, setReminder, snoozeReminder } from '@/lib/reminders';
import { ReminderPanel } from './ReminderPanel';

vi.mock('@/lib/collections', () => ({ remindersCollection: {}, write: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('@/lib/reminders', async (original) => ({
  ...(await original<typeof import('@/lib/reminders')>()),
  setReminder: vi.fn(),
  removeReminder: vi.fn(),
  snoozeReminder: vi.fn(),
  useReminderTimes: () => [{ morning: '08:00', afternoon: '13:00', evening: '18:00' }, vi.fn()],
}));

const note = { id: '0199a0a0-0000-7000-8000-000000000000', userId: 'user-1' };
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const saved: Reminder = {
  noteId: note.id,
  userId: 'user-1',
  kind: 'time',
  startsAt: '2026-10-08T07:30',
  timeZone: zone,
  floating: true,
  recurrence: null,
  nextAt: '2026-10-08T07:30',
  snoozedUntil: null,
  firedAt: null,
};

// Pages swap at once, so a test never acts on the one sliding away.
vi.mock('motion/react', async (original) => ({
  ...(await original<typeof import('motion/react')>()),
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
}));

const onDone = vi.fn();
const step = (name: string) => screen.getByRole('group', { name });
const choice = (group: string, name: string | RegExp) =>
  within(step(group)).getByRole('button', { name });
const openRepeat = () => fireEvent.click(screen.getByRole('button', { name: /^Repeat: / }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Done' }));
const cell = (selector: string) => document.querySelector(selector) as HTMLElement;
/** Chooses a day on the date page, turning to its month first. */
function pickDate(date: string) {
  while (!cell(`[data-date="${date}"]`)) {
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  }
  fireEvent.click(cell(`[data-date="${date}"]`));
}
/** Chooses a time on the time page, on whichever clock the machine running the tests uses. */
function pickTime(time: string) {
  fireEvent.click(choice('Time', /^Custom/));
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  if (cell('[data-period]')) fireEvent.click(cell(`[data-period="${hour >= 12 ? 'PM' : 'AM'}"]`));
  fireEvent.click(cell(`[data-hour="${hour}"]`));
  fireEvent.click(cell(`[data-minute="${minute}"]`));
  back();
}
const pressed = (group: string) =>
  within(step(group))
    .getAllByRole('button', { pressed: true })
    .map((button) => button.textContent);

beforeEach(() => {
  // Radix's switch measures itself, which jsdom cannot.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  // A Monday, at ten in the morning on this device's clock.
  vi.setSystemTime(new Date(2026, 9, 5, 10, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ReminderPanel', () => {
  it('starts at the next quick time and saves it', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    expect(pressed('Day')).toEqual(['Today']);
    expect(pressed('Time')[0]).toContain('Afternoon');
    // The morning is behind us today.
    expect(choice('Time', /Morning/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(note, {
      startsAt: '2026-10-05T13:00',
      timeZone: zone,
      floating: true,
      recurrence: null,
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('lets the day and the time be chosen apart', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    fireEvent.click(choice('Day', 'Tomorrow'));
    fireEvent.click(choice('Time', /Morning/));
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({ startsAt: '2026-10-06T08:00' }),
    );
  });

  it('picks a day and a time that are not among the choices on pages of their own', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    fireEvent.click(choice('Day', 'Custom'));
    // Choosing the day is also going back.
    pickDate('2026-11-20');
    expect(pressed('Day')[0]).toContain('Custom');
    pickTime('21:15');
    expect(pressed('Time')[0]).toContain(formatTimeOfDay('21:15'));
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({ startsAt: '2026-11-20T21:15' }),
    );
  });

  it('keeps the repeat settings folded away until a repeat is chosen', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    expect(screen.queryByRole('button', { name: 'Weekly' })).toBeNull();
    openRepeat();
    fireEvent.click(choice('Repeat', 'Weekly'));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat every: more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thursday' }));
    fireEvent.click(choice('Repeat', 'After'));
    fireEvent.click(screen.getByRole('button', { name: 'Ends after: fewer' }));
    back();
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          weekdays: [1, 4],
          weekdayOfMonth: null,
          until: null,
          count: 9,
        },
      }),
    );
  });

  it('offers the nth weekday of the month the date falls on', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    fireEvent.click(choice('Day', 'Tomorrow'));
    openRepeat();
    fireEvent.click(choice('Repeat', 'Monthly'));
    expect(choice('Repeat', 'Day 6')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(choice('Repeat', 'First Tuesday'));
    back();
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        recurrence: expect.objectContaining({
          frequency: 'monthly',
          weekdayOfMonth: { ordinal: 1, weekday: 2 },
        }),
      }),
    );
  });

  it('will not save a time that has passed', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    pickTime('09:00');
    expect(screen.getByRole('status')).toHaveTextContent('That time has passed');
    expect(screen.getByRole('button', { name: 'Set reminder' })).toBeDisabled();
    // A repeating reminder may start in the past: it rings at its next time.
    openRepeat();
    fireEvent.click(choice('Repeat', 'Daily'));
    back();
    expect(screen.getByRole('button', { name: 'Set reminder' })).toBeEnabled();
  });

  it('opens a saved reminder as it was set, and can pin it to its zone or remove it', () => {
    render(<ReminderPanel note={note} reminder={saved} onDone={onDone} />);
    expect(pressed('Day')[0]).toContain('Custom');
    expect(pressed('Time')[0]).toContain(formatTimeOfDay('07:30'));
    // Custom opens the list of zones, and choosing one comes back.
    fireEvent.click(choice('Time zone', /^Custom/));
    const tokyo = document.querySelector<HTMLElement>('[data-zone="Asia/Tokyo"]');
    expect(tokyo).toHaveTextContent('GMT+9');
    fireEvent.click(tokyo as HTMLElement);
    expect(pressed('Time zone')[0]).toContain('Tokyo, GMT+9');
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({ floating: false, timeZone: 'Asia/Tokyo' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder' }));
    expect(removeReminder).toHaveBeenCalledWith(note.id);
  });

  it('leaves a reminder saved untouched as it was', () => {
    const repeating = {
      ...saved,
      startsAt: '2026-09-01T07:30',
      recurrence: {
        frequency: 'daily' as const,
        interval: 1,
        weekdays: [],
        weekdayOfMonth: null,
        until: null,
        count: 60,
      },
    };
    render(<ReminderPanel note={note} reminder={repeating} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(onDone).toHaveBeenCalled();
    expect(setReminder).not.toHaveBeenCalled();
  });

  it('carries on a counted repeat from the times it has left', () => {
    const repeating = {
      ...saved,
      startsAt: '2026-10-01T07:30',
      nextAt: '2026-10-06T07:30',
      recurrence: {
        frequency: 'daily' as const,
        interval: 1,
        weekdays: [],
        weekdayOfMonth: null,
        until: null,
        count: 60,
      },
    };
    render(<ReminderPanel note={note} reminder={repeating} onDone={onDone} />);
    openRepeat();
    // Five of the sixty have gone by.
    expect(screen.getByRole('status', { name: 'Ends after' })).toHaveTextContent('55 times');
    back();
    pickTime('08:45');
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        startsAt: '2026-10-06T08:45',
        recurrence: expect.objectContaining({ count: 55 }),
      }),
    );
  });

  it('ends a repeat on a day chosen on a page of its own', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    openRepeat();
    fireEvent.click(choice('Repeat', 'Daily'));
    fireEvent.click(choice('Repeat', 'On a date'));
    fireEvent.click(screen.getByRole('button', { name: /^Last day: / }));
    // Days before the reminder starts cannot end it.
    expect(cell('[data-date="2026-10-04"]')).toBeDisabled();
    pickDate('2026-10-28');
    back();
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({
        recurrence: expect.objectContaining({ frequency: 'daily', until: '2026-10-28' }),
      }),
    );
  });

  it('checks the time again when saving, in case the panel sat open past it', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    vi.setSystemTime(new Date(2026, 9, 5, 14, 0));
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('That time has passed');
  });

  it('opens a snoozed one-off on the time it was put off to', () => {
    const rang = {
      ...saved,
      startsAt: '2026-10-05T09:00',
      nextAt: null,
      firedAt: new Date(2026, 9, 5, 9, 0),
      snoozedUntil: new Date(2026, 9, 5, 10, 20, 30),
    };
    render(<ReminderPanel note={note} reminder={rang} onDone={onDone} />);
    expect(pressed('Day')).toEqual(['Today']);
    expect(pressed('Time')[0]).toContain(formatTimeOfDay('10:20'));
    expect(screen.getByRole('status')).toHaveTextContent(/^Snoozed until Today, /);
    // Saved as it is, the snooze stands.
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(setReminder).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it('says a repeating reminder is snoozed while showing its schedule', () => {
    const repeating = {
      ...saved,
      recurrence: {
        frequency: 'daily' as const,
        interval: 1,
        weekdays: [],
        weekdayOfMonth: null,
        until: null,
        count: null,
      },
      snoozedUntil: new Date(2026, 9, 5, 10, 20),
    };
    render(<ReminderPanel note={note} reminder={repeating} onDone={onDone} />);
    expect(pressed('Time')[0]).toContain(formatTimeOfDay('07:30'));
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(/^Snoozed until Today, .* · Daily$/);
    // Changing it sets the reminder afresh, and the summary says when that rings.
    fireEvent.click(choice('Time', /Evening/));
    expect(screen.getAllByRole('status')[0]).not.toHaveTextContent('Snoozed');
  });

  it('offers to ring again for a reminder that rang lately', () => {
    render(
      <ReminderPanel
        note={note}
        reminder={{ ...saved, nextAt: null, firedAt: new Date(2026, 9, 5, 9, 0) }}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remind me again in an hour' }));
    expect(snoozeReminder).toHaveBeenCalledWith(note.id, new Date(2026, 9, 5, 11, 0));
  });
});
