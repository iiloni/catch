import type { Reminder } from '@catch/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { removeReminder, setReminder, snoozeReminder } from '@/lib/reminders';
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

const onDone = vi.fn();
const step = (name: string) => screen.getByRole('group', { name });
const choice = (group: string, name: string | RegExp) =>
  within(step(group)).getByRole('button', { name });
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

  it('shows fields for a day and a time that are not among the choices', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    expect(screen.queryByLabelText('Date')).toBeNull();
    fireEvent.click(choice('Day', 'Pick a date'));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-20' } });
    fireEvent.click(choice('Time', 'Custom'));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '21:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(setReminder).toHaveBeenCalledWith(
      note,
      expect.objectContaining({ startsAt: '2026-11-20T21:15' }),
    );
  });

  it('keeps the repeat settings folded away until a repeat is chosen', () => {
    render(<ReminderPanel note={note} reminder={undefined} onDone={onDone} />);
    expect(screen.queryByRole('status', { name: 'Repeat every' })).toBeNull();
    fireEvent.click(choice('Repeat', 'Weekly'));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat every: more' }));
    fireEvent.click(screen.getByRole('button', { name: 'Thursday' }));
    fireEvent.click(choice('Repeat', 'After'));
    fireEvent.click(screen.getByRole('button', { name: 'Ends after: fewer' }));
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
    fireEvent.click(choice('Repeat', 'Monthly'));
    expect(choice('Repeat', 'Day 6')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(choice('Repeat', 'First Tuesday'));
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
    fireEvent.click(choice('Time', 'Custom'));
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:00' } });
    expect(screen.getByRole('status')).toHaveTextContent('That time has passed');
    expect(screen.getByRole('button', { name: 'Set reminder' })).toBeDisabled();
    // A repeating reminder may start in the past: it rings at its next time.
    fireEvent.click(choice('Repeat', 'Daily'));
    expect(screen.getByRole('button', { name: 'Set reminder' })).toBeEnabled();
  });

  it('opens a saved reminder as it was set, and can pin it to its zone or remove it', () => {
    render(<ReminderPanel note={note} reminder={saved} onDone={onDone} />);
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-08');
    expect(screen.getByLabelText('Time')).toHaveValue('07:30');
    fireEvent.click(screen.getByRole('switch', { name: 'Keep in this time zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save reminder' }));
    expect(setReminder).toHaveBeenCalledWith(note, expect.objectContaining({ floating: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove reminder' }));
    expect(removeReminder).toHaveBeenCalledWith(note.id);
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
