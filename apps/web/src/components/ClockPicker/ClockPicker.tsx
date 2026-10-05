import { motion } from 'motion/react';
import type { ClockPreference } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const CLOCKS = [
  { value: 'auto', label: 'Automatic' },
  { value: '12', label: '12 hour' },
  { value: '24', label: '24 hour' },
] as const satisfies ReadonlyArray<{ value: ClockPreference; label: string }>;

type Props = {
  value: ClockPreference;
  onChange: (clock: ClockPreference) => void;
};

/** A segmented control for how times of day are written. */
export function ClockPicker({ value, onChange }: Props) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-1 p-1.5">
      <legend className="sr-only">Time format</legend>
      {CLOCKS.map(({ value: clock, label }) => {
        const selected = value === clock;
        return (
          <button
            key={clock}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (selected) return;
              haptics.selection();
              onChange(clock);
            }}
            className={cn(
              'relative rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
              selected ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId="clock-indicator"
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
