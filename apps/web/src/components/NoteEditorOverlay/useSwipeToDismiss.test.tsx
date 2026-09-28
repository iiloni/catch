import { fireEvent, render, screen } from '@testing-library/react';
import { motionValue } from 'motion/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { haptics } from '@/lib/haptics';
import { MAX_DRAG, useSwipeToDismiss } from './useSwipeToDismiss';

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));

afterEach(() => vi.clearAllMocks());

function setup(scrollTop: number, scrollHeight = 300) {
  const dragY = motionValue(0);
  const onDismiss = vi.fn();
  function Surface() {
    const ref = useSwipeToDismiss({ dragY, onDismiss, enabled: true });
    return <div ref={ref} data-testid="scroll-area" />;
  }
  render(<Surface />);
  const area = screen.getByTestId('scroll-area');
  Object.defineProperties(area, {
    clientHeight: { value: 100 },
    scrollHeight: { value: scrollHeight },
  });
  area.scrollTop = scrollTop;
  return { area, dragY, onDismiss };
}

function start(area: HTMLElement) {
  fireEvent.touchStart(area, { touches: [{ clientY: 200 }] });
}

function move(area: HTMLElement, delta: number) {
  fireEvent.touchMove(area, { touches: [{ clientY: 200 + delta }] });
}

function end(area: HTMLElement) {
  fireEvent.touchEnd(area, { touches: [] });
}

describe('note editor swipe to dismiss', () => {
  it('attaches when a portal mounts after the first effect', () => {
    const dragY = motionValue(0);
    const onDismiss = vi.fn();
    function Surface({ mounted }: { mounted: boolean }) {
      const ref = useSwipeToDismiss({ dragY, onDismiss, enabled: true });
      return mounted ? <div ref={ref} data-testid="scroll-area" /> : null;
    }
    const view = render(<Surface mounted={false} />);
    view.rerender(<Surface mounted />);
    const area = screen.getByTestId('scroll-area');
    Object.defineProperties(area, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 100 },
    });
    start(area);
    move(area, 130);
    end(area);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each([
    ['down from the top', 0, 1],
    ['up from the bottom', 200, -1],
  ])('caps a %s pull, ticks at the threshold, and closes on release', (_, scrollTop, direction) => {
    const { area, dragY, onDismiss } = setup(scrollTop);
    start(area);
    move(area, direction * 500);
    expect(dragY.get()).toBe(direction * MAX_DRAG);
    expect(haptics.threshold).toHaveBeenCalledTimes(1);

    move(area, direction * 40);
    expect(haptics.threshold).toHaveBeenCalledTimes(1);
    move(area, direction * 130);
    expect(haptics.threshold).toHaveBeenCalledTimes(2);
    end(area);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('keeps a short pull open', () => {
    const { area, onDismiss } = setup(0);
    start(area);
    move(area, 40);
    move(area, 40);
    end(area);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(haptics.threshold).not.toHaveBeenCalled();
  });

  it.each([
    ['down while scrolled', 100, 140],
    ['up while scrolled', 100, -140],
    ['up from the top', 0, -140],
    ['down from the bottom', 200, 140],
  ])('leaves scrolling alone for %s', (_, scrollTop, delta) => {
    const { area, dragY, onDismiss } = setup(scrollTop);
    start(area);
    move(area, delta);
    end(area);
    expect(dragY.get()).toBe(0);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(haptics.threshold).not.toHaveBeenCalled();
  });

  it('does not dismiss when a touch is canceled', () => {
    const { area, onDismiss } = setup(0);
    start(area);
    move(area, 150);
    fireEvent.touchCancel(area, { touches: [] });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
