import { type RefObject, useEffect, useRef } from 'react';
import { TAB_PATHS, type TabPath } from './dockState';
import { LONG_PRESS_MS } from './longPress';

const MOVE_TOLERANCE = 6;
const EDGE_SPACE = 24;

type SwipeControls = {
  onStart: () => void;
  onMove: (delta: number) => void;
  onEnd: (cancelled: boolean, velocity: number, delta: number) => void;
};

/** Settle by distance or a short flick, while keeping a reversed flick on its own side. */
export function swipeDestination(page: TabPath, delta: number, width: number, velocity: number) {
  const distance = Math.abs(delta);
  const flung =
    distance >= 48 && Math.abs(velocity) >= 0.5 && Math.sign(velocity) === Math.sign(delta);
  if (distance + 0.5 < Math.min(120, width * 0.22) && !flung) return null;
  return TAB_PATHS[TAB_PATHS.indexOf(page) + (delta < 0 ? 1 : -1)] ?? null;
}

/** Tap-only search controls can share a drag; editors and other gesture owners keep theirs. */
export function usePageSwipe(
  surface: RefObject<HTMLElement | null>,
  page: TabPath | null,
  controls: SwipeControls,
) {
  const actions = useRef(controls);
  actions.current = controls;
  const availablePage = useRef(page);
  availablePage.current = page;
  const blockedTouch = useRef(false);
  useEffect(() => {
    // An outside press can close a panel before touchstart arrives. That same press
    // still belongs to the panel, even if closing it has already enabled page swipes.
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch') blockedTouch.current = availablePage.current === null;
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const enabled = page !== null;
  // A route committed by the previous swipe must not reattach the listeners: that would
  // drop a touch which already took over the settling page.
  useEffect(() => {
    const element = surface.current;
    if (!element || !enabled) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      time: number;
      dx: number;
      lastTime: number;
      velocity: number;
      dragging: boolean;
      left: boolean;
      right: boolean;
    } | null = null;
    let suppressClick = false;
    let clickTimer: ReturnType<typeof setTimeout> | undefined;

    function onStart(event: TouchEvent) {
      gesture = null;
      clearTimeout(clickTimer);
      suppressClick = false;
      const touch = event.touches[0];
      const target = event.target;
      const selection = window.getSelection();
      if (event.touches.length !== 1 || !touch || !(target instanceof Element)) return;
      if (
        blockedTouch.current ||
        event.defaultPrevented ||
        target.closest(
          'input, textarea, select, [contenteditable], [role="slider"], [role="tab"], [role="dialog"], [role="menu"], [role="listbox"], [data-swipe-archive]',
        ) ||
        (target.closest('button, a, [data-note-card]') &&
          !target.closest('[data-page-swipe-controls]')) ||
        (selection && !selection.isCollapsed) ||
        touch.clientX < EDGE_SPACE ||
        touch.clientX > window.innerWidth - EDGE_SPACE
      )
        return;
      const page = availablePage.current;
      if (!page) return;
      const index = TAB_PATHS.indexOf(page);

      // Remember scroll room before the finger moves: a scroll reaching its edge must
      // finish as a scroll rather than turning into a navigation in the same gesture.
      let left = index < TAB_PATHS.length - 1;
      let right = index > 0;
      for (let parent: Element | null = target; parent; parent = parent.parentElement) {
        if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowX)) continue;
        left &&= parent.scrollLeft + parent.clientWidth >= parent.scrollWidth - 1;
        right &&= parent.scrollLeft <= 1;
      }
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: event.timeStamp,
        dx: 0,
        lastTime: event.timeStamp,
        velocity: 0,
        dragging: false,
        left,
        right,
      };
    }

    function cancel() {
      const state = gesture;
      gesture = null;
      if (state?.dragging) actions.current.onEnd(true, 0, state.dx);
    }

    function onMove(event: TouchEvent) {
      const touch = event.touches[0];
      if (!gesture) return;
      if (
        event.touches.length !== 1 ||
        !touch ||
        touch.identifier !== gesture.id ||
        event.defaultPrevented ||
        !event.cancelable
      ) {
        cancel();
        return;
      }
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (!gesture.dragging) {
        if (Math.hypot(dx, dy) < MOVE_TOLERANCE) return;
        if (
          event.timeStamp - gesture.time >= LONG_PRESS_MS ||
          Math.abs(dx) < Math.abs(dy) * 1.3 ||
          !(dx < 0 ? gesture.left : gesture.right)
        ) {
          gesture = null;
          return;
        }
        gesture.dragging = true;
        suppressClick = true;
        actions.current.onStart();
      }
      event.preventDefault();
      gesture.velocity = (dx - gesture.dx) / Math.max(1, event.timeStamp - gesture.lastTime);
      gesture.lastTime = event.timeStamp;
      gesture.dx = dx;
      actions.current.onMove(dx);
    }

    function onEnd(event: TouchEvent) {
      const finished = gesture;
      gesture = null;
      if (suppressClick) {
        clearTimeout(clickTimer);
        clickTimer = setTimeout(() => {
          suppressClick = false;
        }, 400);
      }
      if (!finished?.dragging) return;
      const cancelled =
        event.type === 'touchcancel' ||
        event.defaultPrevented ||
        event.touches.length !== 0 ||
        !(finished.dx < 0 ? finished.left : finished.right);
      const velocity = event.timeStamp - finished.lastTime < 100 ? finished.velocity : 0;
      actions.current.onEnd(cancelled, velocity, finished.dx);
    }

    function onClick(event: MouseEvent) {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    element.addEventListener('touchstart', onStart, { passive: true });
    // Claim the first horizontal move before the browser starts a native pan.
    element.addEventListener('touchmove', onMove, { passive: false });
    element.addEventListener('touchend', onEnd);
    element.addEventListener('touchcancel', onEnd);
    element.addEventListener('click', onClick, true);
    window.addEventListener('resize', cancel);
    return () => {
      clearTimeout(clickTimer);
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
      element.removeEventListener('click', onClick, true);
      window.removeEventListener('resize', cancel);
    };
  }, [surface, enabled]);
}
