import type { Reminder } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReminderChip } from './ReminderChip';

vi.mock('@/lib/collections', () => ({ remindersCollection: {}, write: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {} }));
vi.mock('@/lib/auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
// Only the wording is fixed, which depends on the machine's language and zone. Whether a
// reminder is past is the real rule.
vi.mock('@/lib/reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reminders')>()),
  describeRecurrence: () => 'Weekly on Mon',
  describeReminder: () => 'Tomorrow, 9:00',
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-04T12:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const reminder: Reminder = {
  noteId: '0199a0a0-0000-7000-8000-000000000000',
  userId: 'user-1',
  kind: 'time',
  startsAt: '2026-10-05T09:00',
  timeZone: 'UTC',
  floating: true,
  recurrence: null,
  nextAt: '2026-10-05T09:00',
  snoozedUntil: null,
  firedAt: null,
};

describe('ReminderChip', () => {
  it('shows when the reminder rings', () => {
    render(<ReminderChip reminder={reminder} />);
    expect(screen.getByLabelText('Reminder: Tomorrow, 9:00')).toHaveTextContent('Tomorrow, 9:00');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('names how a repeating reminder repeats', () => {
    const recurrence = {
      frequency: 'weekly' as const,
      interval: 1,
      weekdays: [1],
      weekdayOfMonth: null,
      until: null,
      count: null,
    };
    render(<ReminderChip reminder={{ ...reminder, recurrence }} />);
    expect(screen.getByLabelText('Reminder: Tomorrow, 9:00, weekly on mon')).toBeInTheDocument();
  });

  it('strikes through a reminder with nothing left to ring for', () => {
    render(<ReminderChip reminder={{ ...reminder, nextAt: null }} />);
    expect(screen.getByLabelText('Past reminder: Tomorrow, 9:00')).toBeInTheDocument();
    expect(screen.getByText('Tomorrow, 9:00')).toHaveClass('line-through');
  });

  it('strikes through one whose time went by more than a minute ago', () => {
    vi.setSystemTime(new Date('2026-10-06T12:00:00Z'));
    render(<ReminderChip reminder={reminder} />);
    expect(screen.getByLabelText('Past reminder: Tomorrow, 9:00')).toBeInTheDocument();
  });

  it('opens the reminder when it is a button', () => {
    const onClick = vi.fn();
    render(<ReminderChip reminder={reminder} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reminder: Tomorrow, 9:00' }));
    expect(onClick).toHaveBeenCalled();
  });
});
