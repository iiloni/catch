import { useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useLayoutEffect, useRef } from 'react';
import { animateSteady, curves, stopSteady } from '@/lib/motion';

// Virtualized cards and remounted routes should not enter again in the same document.
const entered = new Set<string>();

/** Small vertical bands share a start time; long pages never build a long queue. */
export function entryDelayForTop(top: number) {
  return Math.min(120, Math.max(0, Math.round(top / 100)) * 20);
}

export function useEntryMotion(key: string, ready = true, delayMs = 0) {
  const reducedMotion = useReducedMotion();
  const progress = useMotionValue(entered.has(key) || reducedMotion ? 1 : 0);
  const y = useTransform(progress, [0, 1], [10, 0]);
  const delay = useRef(delayMs);

  // Layout changes may update the start delay before readiness, but must not restart an entry.
  useLayoutEffect(() => {
    delay.current = delayMs;
  }, [delayMs]);

  useLayoutEffect(() => {
    if (!ready) return;
    entered.add(key);
    if (progress.get() === 1) return;
    if (reducedMotion) progress.set(1);
    else void animateSteady(progress, 1, curves.enter, delay.current);
    return () => stopSteady(progress);
  }, [key, ready, reducedMotion, progress]);

  return { opacity: progress, y };
}
