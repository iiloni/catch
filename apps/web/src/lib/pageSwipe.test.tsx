import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabPath } from './dockState';
import { usePageSwipe } from './pageSwipe';

vi.mock('./haptics', () => ({ haptics: { selection: vi.fn() } }));

afterEach(() => window.getSelection()?.removeAllRanges());

function setup(page: TabPath | null = '/') {
  const navigate = vi.fn();
  function Page({ path }: { path: TabPath | null }) {
    const surface = useRef<HTMLDivElement>(null);
    usePageSwipe(surface, path, navigate);
    return (
      <div ref={surface} data-testid="page">
        <div data-testid="blank">Page</div>
        <button type="button">Control</button>
        <div data-note-card="note" data-testid="card">
          Note
        </div>
        <div data-testid="scroller" style={{ overflowX: 'auto' }}>
          <span data-testid="column">Column</span>
        </div>
      </div>
    );
  }
  const view = render(<Page path={page} />);
  return {
    navigate,
    setPage: (path: TabPath | null) => view.rerender(<Page path={path} />),
    blank: screen.getByTestId('blank'),
    card: screen.getByTestId('card'),
    button: screen.getByRole('button'),
    scroller: screen.getByTestId('scroller'),
    column: screen.getByTestId('column'),
  };
}

function touch(
  target: HTMLElement,
  type: 'start' | 'move' | 'end' | 'cancel',
  x = 200,
  y = 200,
  time = 0,
  count = 1,
) {
  const touches =
    type === 'end' || type === 'cancel'
      ? []
      : Array.from({ length: count }, (_, identifier) => ({ clientX: x, clientY: y, identifier }));
  const event = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
    cancel: createEvent.touchCancel,
  }[type](target, { touches, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
  return event;
}

function swipe(target: HTMLElement, dx: number, dy = 0, time = 50) {
  touch(target, 'start');
  const move = touch(target, 'move', 200 + dx, 200 + dy, time);
  touch(target, 'end', 200 + dx, 200 + dy, time + 50);
  return move;
}

describe('page swipes', () => {
  it.each([
    ['/deck', -100, '/'],
    ['/', -100, '/search'],
    ['/', 100, '/deck'],
    ['/search', 100, '/'],
  ] as const)('swipes from %s by %i to %s on release', (page, dx, destination) => {
    const { blank, navigate } = setup(page);
    touch(blank, 'start');
    expect(touch(blank, 'move', 200 + dx, 200, 50).defaultPrevented).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    touch(blank, 'end');
    expect(navigate).toHaveBeenCalledExactlyOnceWith(destination);
  });

  it.each([
    ['/deck', 100],
    ['/search', -100],
    [null, 100],
  ] as const)('does not swipe past %s by %i', (page, dx) => {
    const { blank, navigate } = setup(page);
    expect(swipe(blank, dx).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(['card', 'button'] as const)('leaves %s gestures alone', (part) => {
    const page = setup();
    expect(swipe(page[part], 100).defaultPrevented).toBe(false);
    expect(page.navigate).not.toHaveBeenCalled();
  });

  it('ignores short, vertical, held, cancelled and multi-touch gestures', () => {
    const { blank, navigate } = setup();
    swipe(blank, 40);
    swipe(blank, 100, 200);
    swipe(blank, 100, 0, 300);
    touch(blank, 'start');
    touch(blank, 'move', 300, 200, 50);
    touch(blank, 'cancel');
    touch(blank, 'start');
    touch(blank, 'move', 300, 200, 50, 2);
    touch(blank, 'end');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not turn a vertical scroll into a swipe later in the gesture', () => {
    const { blank, navigate } = setup();
    touch(blank, 'start');
    touch(blank, 'move', 202, 220, 20);
    expect(touch(blank, 'move', 300, 220, 70).defaultPrevented).toBe(false);
    touch(blank, 'end');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a scroll that reaches the edge, then accepts a fresh swipe there', () => {
    const { column, scroller, navigate } = setup('/deck');
    Object.defineProperties(scroller, {
      clientWidth: { value: 300 },
      scrollWidth: { value: 900 },
    });
    touch(column, 'start');
    scroller.scrollLeft = 600;
    expect(touch(column, 'move', 100, 200, 50).defaultPrevented).toBe(false);
    touch(column, 'end');
    expect(navigate).not.toHaveBeenCalled();
    swipe(column, -100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/');
  });

  it('does not navigate after reversing into a blocked direction', () => {
    const { blank, navigate } = setup('/deck');
    touch(blank, 'start');
    touch(blank, 'move', 100, 200, 50);
    touch(blank, 'move', 300, 200, 100);
    touch(blank, 'end');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves system edge gestures alone and suppresses a swipe compatibility click', () => {
    const { blank, navigate } = setup();
    touch(blank, 'start', 10);
    touch(blank, 'move', 150, 200, 50);
    touch(blank, 'end');
    expect(navigate).not.toHaveBeenCalled();
    swipe(blank, 100);
    expect(fireEvent.click(blank)).toBe(false);
  });

  it('allows a fresh tap on a control immediately after a short swipe', () => {
    const { blank, button, navigate } = setup();
    swipe(blank, 40);
    touch(button, 'start');
    touch(button, 'end');
    expect(fireEvent.click(button)).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps a touch that dismisses a panel out of page navigation', () => {
    const { blank, navigate, setPage } = setup(null);
    function pointerDown() {
      const event = createEvent.pointerDown(blank, { bubbles: true });
      Object.defineProperty(event, 'pointerType', { value: 'touch' });
      fireEvent(blank, event);
    }
    pointerDown();
    setPage('/');
    swipe(blank, 100);
    expect(navigate).not.toHaveBeenCalled();
    pointerDown();
    swipe(blank, 100);
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/deck');
  });

  it('preserves an existing text selection', () => {
    const { blank, navigate } = setup();
    const range = document.createRange();
    range.selectNodeContents(blank);
    window.getSelection()?.addRange(range);
    expect(swipe(blank, 100).defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
