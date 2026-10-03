import type { Reminder } from '@catch/shared';
import { Bell, Repeat } from 'lucide-react';
import { describeRecurrence, describeReminder, isReminderPast } from '@/lib/reminders';
import { cn } from '@/lib/utils';

type Props = {
  reminder: Reminder;
  /** Makes the chip a button, as in the editor, where it opens the reminder. */
  onClick?: () => void;
  className?: string;
};

/** When a note's reminder rings. One that has rung and has none left is struck through. */
export function ReminderChip({ reminder, onClick, className }: Props) {
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
      <span className={cn('truncate', past && 'line-through')}>{describeReminder(reminder)}</span>
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
      onClick={onClick}
      className={cn(
        chip,
        'min-h-8 px-3 outline-none hover:bg-foreground/[0.1] focus-visible:ring-2 focus-visible:ring-ring/70',
      )}
    >
      {content}
    </button>
  );
}
