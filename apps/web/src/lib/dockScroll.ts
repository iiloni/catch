import { animate, motionValue, useReducedMotion } from 'motion/react';
import { type RefObject, useLayoutEffect, useState } from 'react';
import { springs } from '@/lib/motion';

/** One timeline keeps the dock and the page's bottom edge blur moving together. */
export const dockScrollProgress = motionValue(0);
const MOVEMENT_THRESHOLD = 48;

/** Only document scrolling controls the browsing dock; editors and nested scrollers do not. */
export function useDockScroll(
  pathname: string,
  enabled: boolean,
  dock: RefObject<HTMLElement | null>,
) {
  const [hidden, setHidden] = useState(false);
  const reducedMotion = useReducedMotion();

  // biome-ignore lint/correctness/useExhaustiveDependencies: A new route starts with its dock visible even when its scroll position is restored.
  useLayoutEffect(() => {
    setHidden(false);
    const readY = () => {
      const page = document.scrollingElement;
      const max = page ? Math.max(0, page.scrollHeight - page.clientHeight) : 0;
      return Math.max(0, Math.min(window.scrollY, max));
    };
    let lastY = readY();
    let travel = 0;
    const reset = () => {
      lastY = readY();
      travel = 0;
    };
    const reveal = () => {
      reset();
      setHidden(false);
      // Keyboard focus must never land in controls still travelling up from offscreen.
      dockScrollProgress.stop();
      dockScrollProgress.set(0);
    };
    const onScroll = () => {
      const y = readY();
      const delta = y - lastY;
      lastY = y;
      if (
        !enabled ||
        dock.current?.querySelector(
          ':focus-visible, input:focus, textarea:focus, [contenteditable]:focus',
        )
      ) {
        travel = 0;
        setHidden(false);
        return;
      }
      if (y === 0) {
        travel = 0;
        setHidden(false);
        return;
      }
      if (!delta) return;
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (y < MOVEMENT_THRESHOLD) setHidden(false);
      if (Math.abs(travel) >= MOVEMENT_THRESHOLD) {
        setHidden(travel > 0 && y >= MOVEMENT_THRESHOLD);
        travel = 0;
      }
    };
    const element = dock.current;
    window.addEventListener('scroll', onScroll, { passive: true });
    element?.addEventListener('focusin', reveal);
    element?.addEventListener('focusout', reset);
    return () => {
      window.removeEventListener('scroll', onScroll);
      element?.removeEventListener('focusin', reveal);
      element?.removeEventListener('focusout', reset);
    };
  }, [pathname, enabled, dock]);

  useLayoutEffect(() => {
    if (reducedMotion) {
      dockScrollProgress.jump(hidden ? 1 : 0);
      return;
    }
    const animation = animate(dockScrollProgress, hidden ? 1 : 0, {
      ...springs.smooth,
      bounce: 0,
    });
    return () => animation.stop();
  }, [hidden, reducedMotion]);

  useLayoutEffect(
    () => () => {
      dockScrollProgress.stop();
      dockScrollProgress.set(0);
    },
    [],
  );

  return hidden;
}
