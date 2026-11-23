/**
 * How close to the bottom of the screen (px) a touch starts for the system to take it as its
 * own gesture: Android's swipe home or into recent apps starts on the navigation handle.
 */
export const GESTURE_ZONE = 48;

/**
 * Puts the page back where it was when the system takes a touch away from it. Android sends
 * the start of a swipe from the bottom edge to the page before it decides the swipe is its own
 * and cancels the touch, and by then the page has scrolled with it, enough to fold the header's
 * title into its pill. A touch that ends normally, or starts higher up, is left alone. Returns a
 * function that stops watching.
 */
export function watchSystemGestureScroll() {
  let startY: number | null = null;
  let frame = 0;

  function onStart(event: TouchEvent) {
    cancelAnimationFrame(frame);
    const touch = event.touches[0];
    startY =
      event.touches.length === 1 && touch && window.innerHeight - touch.clientY <= GESTURE_ZONE
        ? window.scrollY
        : null;
  }

  function onEnd() {
    startY = null;
  }

  function onCancel() {
    const top = startY;
    startY = null;
    if (top === null) return;
    const restore = () => {
      if (window.scrollY !== top) window.scrollTo({ top, behavior: 'instant' });
    };
    restore();
    // The scroll of the touch's last moves can land after the cancel.
    frame = requestAnimationFrame(restore);
  }

  window.addEventListener('touchstart', onStart, { passive: true, capture: true });
  window.addEventListener('touchend', onEnd, { passive: true, capture: true });
  window.addEventListener('touchcancel', onCancel, { passive: true, capture: true });
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener('touchstart', onStart, { capture: true });
    window.removeEventListener('touchend', onEnd, { capture: true });
    window.removeEventListener('touchcancel', onCancel, { capture: true });
  };
}
