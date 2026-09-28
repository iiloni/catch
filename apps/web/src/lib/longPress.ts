import { type PointerEvent, useCallback, useEffect, useRef } from 'react';

/**
 * A touch held this long without moving further than the tolerance picks a card up and
 * selects it. Both happen together, as in Keep.
 */
export const LONG_PRESS_MS = 250;
export const LONG_PRESS_TOLERANCE = 8;

/** Stops the click that ends a mouse drag, or a long press without a move, from opening the note. */
export function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener('click', swallow, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 300);
}

/**
 * Pointer handlers that call `onLongPress` when a touch (or pen) is held still. The click
 * that ends the press is swallowed, so it does not also open or toggle the note.
 */
export function useLongPress(onLongPress: (() => void) | undefined) {
  const press = useRef<{ pointerId: number; x: number; y: number; timer: number } | null>(null);
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  if (!onLongPress) return {};
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.pointerType === 'mouse' || !event.isPrimary) return;
      cancel();
      const timer = window.setTimeout(() => {
        press.current = null;
        swallowNextClick();
        callback.current?.();
      }, LONG_PRESS_MS);
      press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const state = press.current;
      if (state?.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - state.x, event.clientY - state.y);
      if (distance > LONG_PRESS_TOLERANCE) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}
