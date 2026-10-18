import { type RefObject, useEffect, useRef } from 'react';
import { TAB_PATHS, type TabPath } from './dockState';
import { haptics } from './haptics';
import { LONG_PRESS_MS } from './longPress';

const MOVE_TOLERANCE = 6;
const RELEASE_DISTANCE = 64;
const EDGE_SPACE = 24;

/** Page swipes yield to cards, controls, native scrolling and the browser's edge gestures. */
export function usePageSwipe(
  surface: RefObject<HTMLElement | null>,
  page: TabPath | null,
  onNavigate: (to: TabPath) => void,
) {
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

  useEffect(() => {
    const element = surface.current;
    if (!element || !page) return;
    const index = TAB_PATHS.indexOf(page);
    let gesture: {
      id: number;
      x: number;
      y: number;
      time: number;
      dx: number;
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
          'button, a, input, textarea, select, [contenteditable], [role="slider"], [role="tab"], [role="dialog"], [role="menu"], [role="listbox"], [data-note-card], [data-swipe-archive]',
        ) ||
        (selection && !selection.isCollapsed) ||
        touch.clientX < EDGE_SPACE ||
        touch.clientX > window.innerWidth - EDGE_SPACE
      )
        return;

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
        dragging: false,
        left,
        right,
      };
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
        gesture = null;
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
      }
      event.preventDefault();
      gesture.dx = dx;
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
      if (
        !finished?.dragging ||
        event.type === 'touchcancel' ||
        event.defaultPrevented ||
        event.touches.length !== 0 ||
        Math.abs(finished.dx) < RELEASE_DISTANCE ||
        !(finished.dx < 0 ? finished.left : finished.right)
      )
        return;
      const to = TAB_PATHS[index + (finished.dx < 0 ? 1 : -1)];
      if (!to) return;
      (document.activeElement as HTMLElement | null)?.blur();
      haptics.selection();
      onNavigate(to);
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
    return () => {
      clearTimeout(clickTimer);
      element.removeEventListener('touchstart', onStart);
      element.removeEventListener('touchmove', onMove);
      element.removeEventListener('touchend', onEnd);
      element.removeEventListener('touchcancel', onEnd);
      element.removeEventListener('click', onClick, true);
    };
  }, [surface, page, onNavigate]);
}
