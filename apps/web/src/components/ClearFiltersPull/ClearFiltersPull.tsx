import { SearchX } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { haptics } from '@/lib/haptics';
import { LONG_PRESS_MS } from '@/lib/longPress';
import { springs } from '@/lib/motion';

/** Finger travel past this distance clears the filters on release. */
const RELEASE_DISTANCE = 90;
/** How far the pill has been drawn by then: it arrives exactly as letting go starts to clear. */
const ARRIVED = RELEASE_DISTANCE * 0.5;
const MAX_PULL = 64;
/** Android's first touchmove can already be this far along; a later claim is not cancelable. */
const MOVE_TOLERANCE = 4;

/**
 * Pulling down at the top of the page clears the search and its filters. Anywhere on the pager
 * counts, as page swipes do, including the tap-only rows and chips the results are made of.
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
  const pill = useRef<HTMLDivElement>(null);
  // From just above the screen, so it passes over the status bar: unlike the sync pill it comes
  // only because the finger is drawing it. Measured as a pull starts: pixels, as the sync pill
  // uses, since a percentage would resolve against Android's changing insets.
  const hiddenY = useRef(0);
  const y = useTransform(() => {
    if (reducedMotion) return 0;
    const travel = pull.get();
    return (
      hiddenY.current * (1 - Math.min(travel, ARRIVED) / ARRIVED) + Math.max(0, travel - ARRIVED)
    );
  });
  // Fading keeps its shadow out of view at rest; it is all reduced motion gets. On the pill
  // itself, because opacity on an ancestor would stop the glass from blurring the page.
  const opacity = useTransform(pull, reducedMotion ? [12, 40] : [0, 12], [0, 1]);
  const width = useMotionValue<number | 'auto'>('auto');
  // Animate the measured width, like the header toolbars, so the glass and text never stretch.
  const measure = useCallback(
    (element: HTMLSpanElement | null) => {
      if (!element) return;
      const update = () => {
        const next = element.offsetWidth + 2;
        if (width.get() === 'auto' || reducedMotion) width.jump(next);
        else animate(width, next, springs.smooth);
      };
      update();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [width, reducedMotion],
  );
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
      // Its words change back out of sight, not at the start of the next pull.
      animate(pull, 0, {
        ...(reducedMotion ? { duration: 0 } : springs.snappy),
        onComplete: () => setArmed(false),
      });
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
        const shape = pill.current;
        if (shape) hiddenY.current = -(shape.offsetTop + shape.offsetHeight + 8);
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

  const label = armed ? 'Release to clear filters' : 'Pull to clear filters';
  return (
    <>
      {createPortal(
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 right-[var(--note-pane)] left-0 z-40 flex justify-center pt-[calc(var(--safe-top)+0.5rem)]"
        >
          <motion.div
            ref={pill}
            data-clear-filters-pill
            style={{ width, y, opacity }}
            className="glass relative h-10 overflow-hidden rounded-full text-sm font-medium"
          >
            <AnimatePresence initial={false}>
              <motion.span
                key={label}
                ref={measure}
                className="absolute inset-y-0 left-1/2 flex w-max items-center gap-2 whitespace-nowrap px-4"
                style={{ x: '-50%' }}
                initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
                animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                exit={{
                  opacity: 0,
                  scale: 0.85,
                  filter: 'blur(4px)',
                  transition: { duration: reducedMotion ? 0 : 0.14 },
                }}
                transition={reducedMotion ? { duration: 0 } : springs.smooth}
              >
                <SearchX className="size-4 text-muted-foreground" aria-hidden />
                {label}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        </div>,
        document.body,
      )}
      <div ref={root}>{children}</div>
    </>
  );
}
