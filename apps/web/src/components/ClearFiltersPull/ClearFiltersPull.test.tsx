import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import { LONG_PRESS_MS } from '@/lib/longPress';
import { ClearFiltersPull } from './ClearFiltersPull';

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));

afterEach(() => {
  vi.clearAllMocks();
  window.scrollY = 0;
});

function setup(enabled = true) {
  const onClear = vi.fn();
  const onPress = vi.fn();
  render(
    <div data-page-pager data-testid="pager">
      <ClearFiltersPull enabled={enabled} onClear={onClear}>
        <button type="button" onClick={onPress}>
          Result
        </button>
        <input aria-label="Field" />
        <div data-testid="scroller" style={{ overflowY: 'auto' }}>
          <p>Inside</p>
        </div>
      </ClearFiltersPull>
    </div>,
  );
  return { onClear, onPress, row: screen.getByRole('button') };
}

function touch(
  target: Element,
  type: 'start' | 'move' | 'end' | 'cancel',
  x: number,
  y: number,
  time = 0,
  count = 1,
) {
  const lifted = type === 'end' || type === 'cancel';
  const touches = lifted
    ? []
    : Array.from({ length: count }, (_, identifier) => ({ clientX: x, clientY: y, identifier }));
  const factory = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
    cancel: createEvent.touchCancel,
  }[type];
  const event = factory(target, { touches, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
  return event;
}

function pull(target: Element, distance = 120) {
  touch(target, 'start', 100, 100);
  const claimed = touch(target, 'move', 100, 100 + distance, 50).defaultPrevented;
  return claimed;
}

describe('clear filters pull', () => {
  it('clears from anywhere on the page, without the click beneath the finger', () => {
    const { onClear, onPress, row } = setup();
    expect(pull(row)).toBe(true);
    expect(screen.getByText('Release to clear filters')).toBeInTheDocument();
    expect(haptics.threshold).toHaveBeenCalledOnce();
    touch(row, 'end', 100, 220, 80);
    fireEvent.click(row);
    expect(onClear).toHaveBeenCalledOnce();
    expect(onPress).not.toHaveBeenCalled();

    onClear.mockClear();
    const pager = screen.getByTestId('pager');
    pull(pager);
    touch(pager, 'end', 100, 220, 80);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('keeps short and fast pulls, and pulling back under the threshold', () => {
    const { onClear, row } = setup();
    pull(row, 40);
    touch(row, 'end', 100, 140, 60);

    touch(row, 'start', 100, 100);
    touch(row, 'move', 100, 220, 50);
    touch(row, 'move', 100, 150, 80);
    expect(screen.getByText('Pull to clear filters')).toBeInTheDocument();
    touch(row, 'end', 100, 150, 90);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('does not clear on a cancelled touch or a second finger', () => {
    const { onClear, row } = setup();
    pull(row);
    touch(row, 'cancel', 100, 220, 80);
    pull(row);
    touch(row, 'move', 100, 220, 80, 2);
    touch(row, 'end', 100, 220, 90);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('leaves sideways, upward and held gestures alone', () => {
    const { onClear, row } = setup();
    touch(row, 'start', 100, 100);
    expect(touch(row, 'move', 220, 130, 50).defaultPrevented).toBe(false);
    touch(row, 'end', 220, 130, 80);

    touch(row, 'start', 100, 200);
    expect(touch(row, 'move', 100, 80, 50).defaultPrevented).toBe(false);
    touch(row, 'end', 100, 80, 80);

    touch(row, 'start', 100, 100);
    expect(touch(row, 'move', 100, 220, LONG_PRESS_MS).defaultPrevented).toBe(false);
    touch(row, 'end', 100, 220, LONG_PRESS_MS + 20);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('leaves scrolling and form fields alone', () => {
    const { onClear } = setup();
    expect(pull(screen.getByRole('textbox'))).toBe(false);

    const scroller = screen.getByTestId('scroller');
    scroller.scrollTop = 20;
    expect(pull(screen.getByText('Inside'))).toBe(false);
    scroller.scrollTop = 0;

    window.scrollY = 40;
    expect(pull(screen.getByRole('button'))).toBe(false);
    expect(onClear).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const { onClear, row } = setup(false);
    expect(pull(row)).toBe(false);
    touch(row, 'end', 100, 220, 80);
    expect(onClear).not.toHaveBeenCalled();
  });
});
