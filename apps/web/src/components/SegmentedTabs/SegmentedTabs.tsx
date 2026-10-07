import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useId } from 'react';
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
  const layoutId = useId();
  const reducedMotion = useReducedMotion();
  return (
    <LayoutGroup id={layoutId}>
      <div
        role="tablist"
        aria-label={label}
        className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-foreground/5 p-1"
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
            {value === option.value && (
              <motion.span
                layoutId="selected-tab"
                aria-hidden
                className="absolute inset-0 rounded-lg bg-foreground/8 shadow-[inset_0_1px_0_var(--glass-highlight)]"
                transition={reducedMotion ? { duration: 0 } : springs.snappy}
              />
            )}
            {option.icon}
            <span className="relative">{option.label}</span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  );
}
