import { animate, motionValue } from 'motion/react';

/**
 * How far the page sits past the scroll edge it was flung into: down at the top, up at the
 * bottom. The page and its large title share it. The browser's own overscroll is off
 * (`overscroll-behavior` in `styles.css`), so a fling would otherwise stop dead at the edge.
 */
export const pageBounceY = motionValue(0);

/** Slower arrivals (px/ms) stop at the edge as they are. */
const MIN_SPEED = 0.4;
/** Faster ones bounce as this one does, which keeps the page within about 70 px of its edge. */
const MAX_SPEED = 3;
/** Scroll events further apart than this (ms) are separate scrolls, not one in motion. */
const MOVING_WITHIN = 80;
/** The speed of a scroll is read over the events of its last moments (ms). */
const SPEED_OVER = 100;
/** Two events can land a millisecond apart, which says nothing of the speed between them. */
const SPEED_OVER_AT_LEAST = 20;
/** Critically damped, so the page comes back to its edge without crossing it. */
const STIFFNESS = 260;
const DAMPING = 2 * Math.sqrt(STIFFNESS);

/**
 * Bounces the page when a scroll reaches its top or bottom at speed. Returns a function
 * that stops watching.
 */
export function watchPageBounce() {
  // The scroll in motion, without the latest step: the edge cuts that one short.
  let samples: { y: number; time: number }[] = [];
  let touching = false;

  function onScroll(event: Event) {
    const page = document.scrollingElement;
    if (!page) return;
    const y = window.scrollY;
    const time = event.timeStamp;
    const last = samples.at(-1);
    // A jump (restored scroll, a shrinking page) arrives with no motion before it.
    if (!last || time - last.time >= MOVING_WITHIN) samples = [];
    const first = samples.find((sample) => time - sample.time <= SPEED_OVER);
    const span = first && last ? last.time - first.time : 0;
    const velocity = first && last && span >= SPEED_OVER_AT_LEAST ? (last.y - first.y) / span : 0;
    const atTop = y <= 0;
    const atBottom = y >= page.scrollHeight - page.clientHeight - 1;
    const arrived =
      last !== undefined &&
      ((atTop && y < last.y && velocity < 0) || (atBottom && y > last.y && velocity > 0));
    if (
      arrived &&
      Math.abs(velocity) >= MIN_SPEED &&
      // A finger on the screen holds the page; the edge pulls of Settings start there too.
      !touching &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      animate(pageBounceY, 0, {
        type: 'spring',
        stiffness: STIFFNESS,
        damping: DAMPING,
        velocity: (atTop ? 1 : -1) * Math.min(Math.abs(velocity), MAX_SPEED) * 1000,
      });
    }
    samples = samples.filter((sample) => time - sample.time <= SPEED_OVER);
    samples.push({ y, time });
  }

  function onTouch(event: TouchEvent) {
    touching = event.touches.length > 0;
  }

  const touchEvents = ['touchstart', 'touchend', 'touchcancel'] as const;
  window.addEventListener('scroll', onScroll, { passive: true });
  for (const type of touchEvents) window.addEventListener(type, onTouch, { passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll);
    for (const type of touchEvents) window.removeEventListener(type, onTouch);
    pageBounceY.stop();
    pageBounceY.set(0);
  };
}
