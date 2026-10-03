import type { Reminder } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reminderSheet, removeReminder, setReminder } from '@/lib/reminders';
import { ReminderSheet } from './ReminderSheet';

const noteId = '0199a0a0-0000-7000-8000-000000000001';
const reminders = new Map<string, Reminder>();
vi.mock('@/lib/collections', () => ({
  notesCollection: { get: (id: string) => ({ id, userId: 'user-1' }) },
  useReminders: () => reminders,
}));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/reminders', async (original) => ({
  ...(await original<typeof import('@/lib/reminders')>()),
  deviceTimeZone: () => 'Europe/Berlin',
  setReminder: vi.fn(),
  removeReminder: vi.fn(),
}));

// The switch sits in a form, where Radix measures it to place a hidden input.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

function openSheet() {
  render(<ReminderSheet />);
  act(() => reminderSheet.set(noteId));
  return screen.getByRole('dialog', { name: 'Remind me' });
}

afterEach(() => {
  act(() => reminderSheet.set(null));
  reminders.clear();
  vi.clearAllMocks();
});

describe('ReminderSheet', () => {
  it('saves a reminder on the nth weekday of each month', () => {
    openSheet();
    // 2031-03-11 is the second Tuesday of March.
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2031-03-11' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '18:30' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'monthly' } });
    fireEvent.change(screen.getByLabelText('On'), { target: { value: 'nth' } });
    expect(screen.getByRole('option', { name: 'The second Tuesday' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setReminder).toHaveBeenCalledWith(
      { id: noteId, userId: 'user-1' },
      {
        startsAt: '2031-03-11T18:30',
        timeZone: 'Europe/Berlin',
        floating: true,
        recurrence: {
          frequency: 'monthly',
          interval: 1,
          weekdays: [],
          weekdayOfMonth: { ordinal: 2, weekday: 2 },
          until: null,
          count: null,
        },
      },
    );
    expect(reminderSheet.get()).toBeNull();
  });

  it('offers the last weekday, and the last day for dates short months lack', () => {
    openSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2031-03-31' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'monthly' } });
    expect(
      screen.getByRole('option', { name: /^Day 31, or the month.s last day$/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'The last Monday' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /fifth/ })).toBeNull();
  });

  it('keeps a reminder in its time zone when asked, and ends it after a count', () => {
    openSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2031-03-11' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: 'count' } });
    fireEvent.change(screen.getByLabelText('Times'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Keep in this time zone' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(setReminder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        floating: false,
        timeZone: 'Europe/Berlin',
        recurrence: expect.objectContaining({ frequency: 'daily', count: 3, until: null }),
      }),
    );
  });

  it('refuses a one-off time that has passed', () => {
    openSheet();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('That time has passed');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows an existing reminder and removes it', () => {
    reminders.set(noteId, {
      noteId,
      userId: 'user-1',
      kind: 'time',
      startsAt: '2031-03-04T09:30',
      timeZone: 'Asia/Tokyo',
      floating: false,
      recurrence: {
        frequency: 'weekly',
        interval: 2,
        weekdays: [2, 4],
        weekdayOfMonth: null,
        until: null,
        count: null,
      },
      nextAt: '2031-03-06T09:30',
      snoozedUntil: null,
      firedAt: null,
    });
    openSheet();
    // It opens on the occurrence it is waiting for, in the zone it is kept in.
    expect(screen.getByLabelText('Date')).toHaveValue('2031-03-06');
    expect(screen.getByLabelText('Every how many weeks')).toHaveValue(2);
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Keep in Asia/Tokyo time')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Keep in this time zone' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeReminder).toHaveBeenCalledWith(noteId);
  });
});
