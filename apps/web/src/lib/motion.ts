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
  /** Full-screen transitions such as a card opening into the editor. */
  expand: { type: 'spring', visualDuration: 0.45, bounce: 0.12 },
} satisfies Record<string, Transition>;
