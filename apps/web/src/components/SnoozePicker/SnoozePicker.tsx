import { motion } from 'motion/react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import type { SnoozeMinutes } from '@/lib/snooze';
import { cn } from '@/lib/utils';

const LENGTHS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hr' },
] as const satisfies ReadonlyArray<{ value: SnoozeMinutes; label: string }>;

type Props = {
  value: SnoozeMinutes;
  onChange: (minutes: SnoozeMinutes) => void;
};

/** A segmented control for how long Snooze puts a reminder off. */
export function SnoozePicker({ value, onChange }: Props) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-1 p-1.5">
      <legend className="sr-only">Snooze length</legend>
      {LENGTHS.map(({ value: minutes, label }) => {
        const selected = value === minutes;
        return (
          <button
            key={minutes}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (selected) return;
              haptics.selection();
              onChange(minutes);
            }}
            className={cn(
              'relative rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
              selected ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId="snooze-indicator"
                aria-hidden
                className="absolute inset-0 rounded-xl bg-background shadow-sm"
                transition={springs.snappy}
              />
            )}
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
