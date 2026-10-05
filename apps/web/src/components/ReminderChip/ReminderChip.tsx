import type { Reminder } from '@catch/shared';
import { Bell, Repeat } from 'lucide-react';
import { useHour12 } from '@/lib/clock';
import {
  describeRecurrence,
  describeReminder,
  isReminderPast,
  useReminderClock,
} from '@/lib/reminders';
import { cn } from '@/lib/utils';

type Props = {
  reminder: Reminder;
  /** Makes the chip a button, as in the editor, where it opens the reminder. */
  onClick?: () => void;
  className?: string;
};

/** When a note's reminder rings. One that has rung and has none left is struck through. */
export function ReminderChip({ reminder, onClick, className }: Props) {
  // Redraws the times below when the clock setting changes.
  useHour12();
  // And when its time comes, which nothing else here would notice.
  useReminderClock();
  const past = isReminderPast(reminder);
  const Icon = reminder.recurrence ? Repeat : Bell;
  const label = `${past ? 'Past reminder' : 'Reminder'}: ${describeReminder(reminder)}${
    reminder.recurrence ? `, ${describeRecurrence(reminder.recurrence).toLowerCase()}` : ''
  }`;
  const chip = cn(
    'inline-flex max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.07] px-2.5 py-1 text-xs',
    past && 'text-muted-foreground',
    className,
  );
  const content = (
    <>
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className={cn('min-w-0 truncate', past && 'line-through')}>
        {describeReminder(reminder)}
      </span>
    </>
  );
  if (!onClick) {
    return (
      <span data-reminder-chip role="img" aria-label={label} className={chip}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-reminder-chip
      aria-label={label}
      // Keeps the editor's focus, and with it the keyboard, while the panel opens.
      onPointerDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        chip,
        // The pill stays small; the area that takes a tap is a full touch target.
        'relative min-h-8 px-3 outline-none after:absolute after:inset-x-0 after:-inset-y-1.5 hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/70',
      )}
    >
      {content}
    </button>
  );
}
