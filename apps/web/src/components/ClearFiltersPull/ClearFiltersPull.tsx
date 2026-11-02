import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { haptics } from '@/lib/haptics';
import { LONG_PRESS_MS } from '@/lib/longPress';
import { springs } from '@/lib/motion';

/** Finger travel past this distance clears the filters on release. */
const RELEASE_DISTANCE = 90;
const MAX_PULL = 64;
/** Android's first touchmove can already be this far along; a later claim is not cancelable. */
const MOVE_TOLERANCE = 4;

/**
 * Pulling down at the top of the page clears the filters. Anywhere on the pager counts, as
 * page swipes do, including the tap-only rows and chips the filtered results are made of.
 * There is no undo, so unlike the edge pulls that close a surface a fling does not commit.
 */
export function ClearFiltersPull({
  enabled,
  onClear,
  children,
}: {
  enabled: boolean;
  onClear: () => void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pull = useMotionValue(0);
  const reducedMotion = useReducedMotion() ?? false;
  const y = useTransform(() => (reducedMotion ? 0 : pull.get()));
  const indicatorOpacity = useTransform(pull, [12, 40], [0, 1]);
  const [armed, setArmed] = useState(false);
  const clear = useRef(onClear);
  clear.current = onClear;
  const available = useRef(enabled);
  available.current = enabled;
  const blockedTouch = useRef(false);

  useEffect(() => {
    // The press that closes the filter panel enables this before its touchstart arrives.
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch') blockedTouch.current = !available.current;
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  useEffect(() => {
    const surface = root.current?.closest('[data-page-pager]') ?? root.current;
    if (!surface || !enabled) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      time: number;
      distance: number;
      dragging: boolean;
      armed: boolean;
    } | null = null;
    let suppressClick = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    function springBack() {
      animate(pull, 0, reducedMotion ? { duration: 0 } : springs.snappy);
    }

    function cancel() {
      if (gesture?.dragging) springBack();
      gesture = null;
    }

    function onStart(event: Event) {
      const { touches, target, timeStamp } = event as TouchEvent;
      cancel();
      clearTimeout(clickTimer);
      suppressClick = false;
      const touch = touches[0];
      const selection = window.getSelection();
      if (
        touches.length !== 1 ||
        !touch ||
        !(target instanceof Element) ||
        blockedTouch.current ||
        window.scrollY > 1 ||
        (selection && !selection.isCollapsed) ||
        target.closest(
          'input, textarea, select, [contenteditable], [role="slider"], [role="dialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      for (
        let parent: Element | null = target;
        parent && parent !== surface;
        parent = parent.parentElement
      ) {
        if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollTop > 1)
          return;
      }
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: timeStamp,
        distance: 0,
        dragging: false,
        armed: false,
      };
    }

    function onMove(event: Event) {
      if (!gesture) return;
      const move = event as TouchEvent;
      const touch = move.touches[0];
      if (
        move.touches.length !== 1 ||
        touch?.identifier !== gesture.id ||
        move.defaultPrevented ||
        !move.cancelable
      )
        return cancel();
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.hypot(dx, dy) < MOVE_TOLERANCE) return;
        // Sideways belongs to page swipes, holding to a result's long press.
        if (dy < Math.abs(dx) * 1.3 || move.timeStamp - gesture.time >= LONG_PRESS_MS) {
          gesture = null;
          return;
        }
        gesture.dragging = true;
        suppressClick = true;
        pull.stop();
        setArmed(false);
      }
      move.preventDefault();
      gesture.distance = Math.max(0, dy);
      pull.set(Math.min(gesture.distance * 0.5, MAX_PULL));
      const past = gesture.distance > RELEASE_DISTANCE;
      if (past !== gesture.armed) {
        gesture.armed = past;
        setArmed(past);
        if (past) haptics.threshold();
      }
    }

    function onEnd(event: Event) {
      const { type, touches, defaultPrevented } = event as TouchEvent;
      const finished = gesture;
      gesture = null;
      if (!finished?.dragging) return;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 400);
      springBack();
      if (finished.armed && type !== 'touchcancel' && !defaultPrevented && touches.length === 0)
        clear.current();
    }

    function onClick(event: Event) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    surface.addEventListener('touchstart', onStart, { passive: true });
    surface.addEventListener('touchmove', onMove, { passive: false });
    surface.addEventListener('touchend', onEnd);
    surface.addEventListener('touchcancel', onEnd);
    surface.addEventListener('click', onClick, true);
    return () => {
      cancel();
      clearTimeout(clickTimer);
      surface.removeEventListener('touchstart', onStart);
      surface.removeEventListener('touchmove', onMove);
      surface.removeEventListener('touchend', onEnd);
      surface.removeEventListener('touchcancel', onEnd);
      surface.removeEventListener('click', onClick, true);
    };
  }, [enabled, pull, reducedMotion]);

  return (
    <div ref={root} className="relative">
      <motion.div
        aria-hidden
        style={{ opacity: indicatorOpacity }}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
      >
        <span className="glass-badge flex h-8 items-center rounded-full px-3 text-xs font-medium">
          {armed ? 'Release to clear filters' : 'Pull to clear filters'}
        </span>
      </motion.div>
      <motion.div style={{ y }}>{children}</motion.div>
    </div>
  );
}
