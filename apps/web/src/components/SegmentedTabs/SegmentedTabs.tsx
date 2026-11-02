import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { springs } from '@/lib/motion';

type Tab<TValue extends string> = {
  value: TValue;
  id: string;
  controls: string;
  label: string;
  icon: ReactNode;
};

export function SegmentedTabs<TValue extends string>({
  label,
  value,
  onValueChange,
  options,
  disabled = false,
}: {
  label: string;
  value: TValue;
  onValueChange: (value: TValue) => void;
  options: readonly [Tab<TValue>, Tab<TValue>];
  disabled?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <div
      role="tablist"
      aria-label={label}
      className="relative grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/5 p-1"
      onKeyDown={(event) => {
        if (disabled) return;
        const next =
          event.key === 'Home'
            ? options[0]
            : event.key === 'End'
              ? options[1]
              : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                ? options.find((option) => option.value !== value)
                : null;
        if (!next) return;
        event.preventDefault();
        onValueChange(next.value);
        document.getElementById(next.id)?.focus();
      }}
    >
      {/* Keep the spring local when a growing popover moves the entire tab strip. */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.75rem)/2)] rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]"
        initial={false}
        animate={{
          x: value === options[0].value ? 'calc(0% + 0rem)' : 'calc(100% + 0.25rem)',
        }}
        transition={reducedMotion ? { duration: 0 } : springs.snappy}
      />
      {options.map((option) => (
        <button
          key={option.value}
          id={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          aria-controls={option.controls}
          tabIndex={value === option.value ? 0 : -1}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (value !== option.value) onValueChange(option.value);
          }}
          className="relative flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 font-medium text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          {option.icon}
          <span className="relative">{option.label}</span>
        </button>
      ))}
    </div>
  );
}
