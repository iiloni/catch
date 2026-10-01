import { cancelFrame, cubicBezier, frame, type MotionValue, type Transition } from 'motion/react';

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
  /** The note pane sliding in beside the page. No bounce, which would pull it off the edge. */
  pane: { type: 'spring', visualDuration: 0.45, bounce: 0 },
} satisfies Record<string, Transition>;

/**
 * A brief, gentle acceleration, then a long soft landing with no overshoot (Material's
 * "emphasized" curve). Starts calmer than a pure ease-out, which lurches off the mark.
 */
export const EASE_EMPHASIZED = [0.2, 0, 0, 1] as const;

/**
 * Eased curves for full-screen transitions, where a spring's overshoot would push the
 * surface past the screen edge. CSS uses the same curve as `--ease-emphasized`.
 */
export const curves = {
  /** A card opening into the editor. */
  expand: { duration: 0.55, ease: EASE_EMPHASIZED },
  /** The editor settling back into its card. */
  collapse: { duration: 0.5, ease: EASE_EMPHASIZED },
} satisfies Record<string, Transition>;

const steady = new WeakMap<MotionValue<number>, () => void>();

/**
 * Runs one of the `curves` on a motion value by frames rather than by the clock: each frame
 * moves the animation on by the time since the last one, up to a limit, so a frame held up
 * by other work is followed by the next step, not by wherever the clock has got to. `animate`
 * keeps time, and opening a note mounts its editor while the surface grows: that work came
 * out of the start of the transition, which then jumped most of the way open in one frame.
 *
 * Resolves when the animation completes; never, if another one takes the value over first.
 */
export function animateSteady(
  value: MotionValue<number>,
  to: number,
  { duration, ease }: (typeof curves)[keyof typeof curves],
) {
  steady.get(value)?.();
  value.stop();
  const from = value.get();
  const eased = cubicBezier(...ease);
  let elapsed = 0;
  return new Promise<void>((resolve) => {
    const stop = () => {
      cancelFrame(step);
      steady.delete(value);
    };
    // Motion's frame loop is what limits `delta` (to 40 ms).
    const step = ({ delta }: { delta: number }) => {
      elapsed += delta;
      const time = Math.min(1, elapsed / (duration * 1000));
      value.set(from + (to - from) * eased(time));
      if (time < 1) return;
      stop();
      resolve();
    };
    steady.set(value, stop);
    frame.update(step, true);
  });
}

/**
 * Calls back once the browser has drawn the page as it is now, with the work that got it
 * there out of the way. Returns a function that cancels the call.
 */
export function afterPaint(callback: () => void) {
  let request = requestAnimationFrame(() => {
    request = requestAnimationFrame(callback);
  });
  return () => cancelAnimationFrame(request);
}
