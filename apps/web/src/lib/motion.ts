import type { Transition } from 'motion/react';

/**
 * Spring presets. Springs (rather than eased durations) keep animations
 * interruptible: a new target picks up the current velocity instead of snapping.
 */
export const springs = {
  /** Small controls: the tab indicator, press feedback, icon swaps. */
  snappy: { type: 'spring', visualDuration: 0.3, bounce: 0.2 },
  /** Surfaces that change size: the dock, the quick-note window. */
  smooth: { type: 'spring', visualDuration: 0.4, bounce: 0.15 },
  /** Things that should feel thrown, like the quick-note window opening. */
  bouncy: { type: 'spring', visualDuration: 0.45, bounce: 0.28 },
} satisfies Record<string, Transition>;

/** Fast out of the gate, long gentle landing, no overshoot (an exponential ease-out). */
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * Eased curves for full-screen transitions, where a spring's overshoot would push the
 * surface past the screen edge. CSS uses the same curve as `--ease-out-expo`.
 */
export const curves = {
  /** A card opening into the editor. */
  expand: { duration: 0.5, ease: EASE_OUT_EXPO },
  /** The editor settling back into its card. */
  collapse: { duration: 0.45, ease: EASE_OUT_EXPO },
} satisfies Record<string, Transition>;
