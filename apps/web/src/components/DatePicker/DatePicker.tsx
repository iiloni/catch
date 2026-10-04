import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { haptics } from '@/lib/haptics';
import { cn } from '@/lib/utils';

type Props = {
  /** The chosen date, as `YYYY-MM-DD`. */
  value: string;
  /** The first date that can be chosen. */
  min?: string;
  /** Today on the user's calendar, which the grid marks. */
  today: string;
  onChange: (value: string) => void;
  className?: string;
};

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

// Dates are calendar dates, apart from any zone, so they are read and written in UTC.
const monthName = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const dayName = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeZone: 'UTC' });
const weekdayName = new Intl.DateTimeFormat(undefined, { weekday: 'narrow', timeZone: 'UTC' });
// 2023-01-01 was a Sunday.
const WEEKDAYS = Array.from({ length: 7 }, (_, day) =>
  weekdayName.format(new Date(Date.UTC(2023, 0, 1 + day))),
);

function monthOf(value: string) {
  const [year = 1970, month = 1] = value.split('-').map(Number);
  return { year, month: month - 1 };
}

/** A month of days to choose one from, a tap each, with arrows to the months beside it. */
export function DatePicker({ value, min, today, onChange, className }: Props) {
  const [shown, setShown] = useState(() => monthOf(value || today));
  const first = new Date(Date.UTC(shown.year, shown.month, 1));
  const days = new Date(Date.UTC(shown.year, shown.month + 1, 0)).getUTCDate();
  const move = (by: number) => {
    haptics.selection();
    const next = new Date(Date.UTC(shown.year, shown.month + by, 1));
    setShown({ year: next.getUTCFullYear(), month: next.getUTCMonth() });
  };
  // Nothing in the month before the first date allowed is worth turning back to.
  const atStart = min !== undefined && iso(shown.year, shown.month, 1) <= min;
  const arrow =
    'flex size-10 items-center justify-center rounded-xl outline-none hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-30';

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center">
        <button
          type="button"
          aria-label="Previous month"
          disabled={atStart}
          onClick={() => move(-1)}
          className={arrow}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <p aria-live="polite" className="flex-1 text-center font-medium text-sm">
          {monthName.format(first)}
        </p>
        <button type="button" aria-label="Next month" onClick={() => move(1)} className={arrow}>
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>
      <div aria-hidden className="grid grid-cols-7 text-center text-muted-foreground text-xs">
        {WEEKDAYS.map((name, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: narrow weekday names repeat (T, S)
          <span key={index} className="py-1">
            {name}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: days }, (_, index) => {
          const day = index + 1;
          const date = iso(shown.year, shown.month, day);
          const selected = date === value;
          return (
            <button
              key={date}
              type="button"
              data-date={date}
              aria-label={dayName.format(new Date(Date.UTC(shown.year, shown.month, day)))}
              aria-pressed={selected}
              aria-current={date === today ? 'date' : undefined}
              disabled={min !== undefined && date < min}
              // The first day sits under its weekday.
              style={day === 1 ? { gridColumnStart: first.getUTCDay() + 1 } : undefined}
              onClick={() => {
                haptics.selection();
                onChange(date);
              }}
              className={cn(
                'mx-auto flex size-10 items-center justify-center rounded-full text-sm tabular-nums outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-30',
                selected
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'hover:bg-foreground/[0.08] aria-[current=date]:bg-foreground/[0.08] aria-[current=date]:font-medium',
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
