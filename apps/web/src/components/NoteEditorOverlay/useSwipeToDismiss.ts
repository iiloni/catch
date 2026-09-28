import { animate, type MotionValue } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';

/** Finger travel past this distance closes the editor on release. */
const DISMISS_DISTANCE = 110;
/** The surface stays within this distance of its resting position. */
export const MAX_DRAG = 180;

/** Pull down at the top or up at the bottom; let scrolling work between the edges. */
export function useSwipeToDismiss({
  dragY,
  onDismiss,
  enabled,
}: {
  dragY: MotionValue<number>;
  onDismiss: () => void;
  enabled: boolean;
}) {
  // Radix mounts the dialog portal after this hook's first effect has run.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!element || !enabled) return;
    let startY: number | null = null;
    let dragging = false;
    let armed = false;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let direction = 0;

    function onStart(event: TouchEvent) {
      if (!element || event.touches.length !== 1) {
        startY = null;
        return;
      }
      dragY.stop();
      startY = event.touches[0]?.clientY ?? null;
      dragging = false;
      armed = false;
      direction = 0;
      lastY = startY ?? 0;
      lastTime = event.timeStamp;
      velocity = 0;
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (startY === null || !touch || !element || event.touches.length !== 1) return;
      const delta = touch.clientY - startY;
      if (!dragging) {
        if (Math.abs(delta) < 8) return;
        const atTop = element.scrollTop <= 1;
        const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
        if ((delta > 0 && !atTop) || (delta < 0 && !atBottom)) {
          startY = null;
          return;
        }
        direction = Math.sign(delta);
        dragging = true;
        // Typing into a note while pulling it away would be surprising.
        (document.activeElement as HTMLElement | null)?.blur();
      }
      event.preventDefault();
      velocity = (touch.clientY - lastY) / Math.max(1, event.timeStamp - lastTime);
      lastY = touch.clientY;
      lastTime = event.timeStamp;
      // Rubber-band: the surface follows the finger less the further it goes,
      // then stops at the cap instead of sliding off the screen.
      const distance = Math.max(0, delta * direction - 8);
      dragY.set(direction * Math.min(distance * 0.75, MAX_DRAG));
      const past = distance > DISMISS_DISTANCE;
      if (past !== armed) {
        armed = past;
        if (past) haptics.threshold();
      }
    }

    function onEnd(event: TouchEvent) {
      const flung = Math.abs(dragY.get()) >= 24 && velocity * direction > 0.6;
      if (
        dragging &&
        event.type !== 'touchcancel' &&
        event.touches.length === 0 &&
        (armed || flung)
      ) {
        if (!armed) haptics.threshold();
        onDismissRef.current();
      } else if (dragging) {
        animate(dragY, 0, springs.snappy);
      }
      startY = null;
      dragging = false;
    }

    element.addEventListener('touchstart', onStart, { passive: true });
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    return () => {
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
    };
  }, [dragY, element, enabled]);

  return setElement;
}
