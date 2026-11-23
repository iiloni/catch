import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GESTURE_ZONE, watchSystemGestureScroll } from './systemGestures';

const VIEWPORT = 800;

let scrollY = 0;
let stop: () => void;
const scrollTo = vi.fn();

function touch(type: 'touchstart' | 'touchend' | 'touchcancel', ...ys: number[]) {
  const event = new Event(type);
  Object.defineProperty(event, 'touches', { value: ys.map((clientY) => ({ clientY })) });
  window.dispatchEvent(event);
}

beforeEach(() => {
  scrollY = 0;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(VIEWPORT);
  scrollTo.mockImplementation(({ top }: { top: number }) => {
    scrollY = top;
  });
  window.scrollTo = scrollTo;
  stop = watchSystemGestureScroll();
});

afterEach(() => {
  stop();
  scrollTo.mockReset();
  vi.restoreAllMocks();
});

describe('watchSystemGestureScroll', () => {
  it('puts back the scroll of a bottom edge touch the system cancels', () => {
    scrollY = 300;
    touch('touchstart', VIEWPORT - 10);
    scrollY = 324;
    touch('touchcancel');
    expect(scrollY).toBe(300);
  });

  it('puts back scroll that lands after the cancel', async () => {
    touch('touchstart', VIEWPORT - 10);
    touch('touchcancel');
    scrollY = 12;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scrollY).toBe(0);
  });

  it('leaves a bottom edge touch the page keeps', () => {
    touch('touchstart', VIEWPORT - 10);
    scrollY = 40;
    touch('touchend');
    touch('touchcancel');
    expect(scrollY).toBe(40);
  });

  it('leaves a cancelled touch that started above the gesture zone', () => {
    touch('touchstart', VIEWPORT - GESTURE_ZONE - 1);
    scrollY = 40;
    touch('touchcancel');
    expect(scrollY).toBe(40);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('leaves a cancelled pinch', () => {
    touch('touchstart', VIEWPORT - 10, VIEWPORT - 200);
    scrollY = 40;
    touch('touchcancel');
    expect(scrollY).toBe(40);
  });

  it('stops watching', () => {
    stop();
    touch('touchstart', VIEWPORT - 10);
    scrollY = 40;
    touch('touchcancel');
    expect(scrollY).toBe(40);
  });
});
