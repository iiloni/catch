import { useReducedMotion } from 'motion/react';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

/** Match the row's scroll padding to this, so a focused tool never lands under a fade. */
const FADE_PX = 28;
const LINE_PX = 16;

/**
 * Makes a sideways-scrolling row of tools work without a touch screen: an ordinary wheel
 * scrolls it, and it reports which ends have more to show. The fades grow with the distance
 * left to scroll, so the tool at either end is fully visible once it has been reached.
 */
export function useToolRowScroll(
  frame: RefObject<HTMLElement | null>,
  row: RefObject<HTMLElement | null>,
) {
  const [more, setMore] = useState({ before: false, after: false });
  const reducedMotion = useReducedMotion();
  const animated = useRef(!reducedMotion);
  animated.current = !reducedMotion;

  useEffect(() => {
    const surface = frame.current;
    const element = row.current;
    if (!surface || !element) return;

    function update(target: HTMLElement) {
      const before = target.scrollLeft;
      const after = target.scrollWidth - target.clientWidth - before;
      // Set directly: a re-render on every scrolled pixel would rebuild each tool's tooltip.
      target.style.setProperty('--fade-before', `${Math.min(before, FADE_PX)}px`);
      target.style.setProperty('--fade-after', `${Math.min(Math.max(after, 0), FADE_PX)}px`);
      // Zoomed displays leave a fraction of a pixel of a finished scroll unreachable.
      const next = { before: before > 1, after: after > 1 };
      setMore((current) =>
        current.before === next.before && current.after === next.after ? current : next,
      );
    }
    const refresh = () => update(element);

    function onWheel(event: WheelEvent) {
      if (!element) return;
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_PX
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? element.clientWidth
            : 1;
      const limit = element.scrollWidth - element.clientWidth;
      const next = Math.min(limit, Math.max(0, element.scrollLeft + event.deltaY * unit));
      if (next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    }

    refresh();
    element.addEventListener('scroll', refresh, { passive: true });
    // Not React's onWheel: it is passive, and a scroll it handled would move the page too.
    surface.addEventListener('wheel', onWheel, { passive: false });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refresh);
    resize?.observe(element);
    return () => {
      element.removeEventListener('scroll', refresh);
      surface.removeEventListener('wheel', onWheel);
      resize?.disconnect();
    };
  }, [frame, row]);

  const page = useCallback(
    (direction: -1 | 1) => {
      const element = row.current;
      element?.scrollBy({
        left: direction * element.clientWidth * 0.75,
        behavior: animated.current ? 'smooth' : 'auto',
      });
    },
    [row],
  );

  return { more, page };
}
