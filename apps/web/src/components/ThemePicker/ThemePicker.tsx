import { Monitor, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import type { ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEMES = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: unknown }>;

type Props = {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
};

/** A segmented control for the app's theme. */
export function ThemePicker({ value, onChange }: Props) {
  return (
    <fieldset className="grid min-w-0 grid-cols-3 gap-1 p-1.5">
      <legend className="sr-only">Theme</legend>
      {THEMES.map(({ value: theme, label, icon: Icon }) => {
        const selected = value === theme;
        return (
          <button
            key={theme}
            type="button"
            aria-pressed={selected}
            onClick={() => {
              if (selected) return;
              haptics.selection();
              onChange(theme);
            }}
            className={cn(
              'relative flex flex-col items-center gap-1 rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
              selected ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {selected && (
              <motion.span
                layoutId="theme-indicator"
                aria-hidden
                className="absolute inset-0 rounded-xl bg-background shadow-sm"
                transition={springs.snappy}
              />
            )}
            <Icon className="relative size-5" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
