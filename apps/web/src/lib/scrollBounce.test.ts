import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageBounceY, watchPageBounce } from './scrollBounce';

const PAGE_HEIGHT = 3000;
const VIEWPORT = 800;
const BOTTOM = PAGE_HEIGHT - VIEWPORT;

let scrollY = 0;
let stop: () => void;

/** Reports the page at each `[time, scrollY]` in turn, as scroll events do. */
function scrollThrough(...steps: [number, number][]) {
  for (const [time, y] of steps) {
    scrollY = y;
    const event = new Event('scroll');
    Object.defineProperty(event, 'timeStamp', { value: time });
    window.dispatchEvent(event);
  }
}

/** The furthest the page gets from its edge before the bounce has settled. */
async function peak() {
  let furthest = 0;
  const watching = pageBounceY.on('change', (y) => {
    if (Math.abs(y) > Math.abs(furthest)) furthest = y;
  });
  await vi.waitFor(() => expect(pageBounceY.isAnimating()).toBe(false), { timeout: 3000 });
  watching();
  return furthest;
}

beforeEach(() => {
  scrollY = 1000;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  const page = document.documentElement;
  // jsdom has no scrollingElement.
  Object.defineProperty(document, 'scrollingElement', { value: page, configurable: true });
  vi.spyOn(page, 'scrollHeight', 'get').mockReturnValue(PAGE_HEIGHT);
  vi.spyOn(page, 'clientHeight', 'get').mockReturnValue(VIEWPORT);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  stop = watchPageBounce();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe('watchPageBounce', () => {
  it('carries a fling into the top on past it, then back', async () => {
    scrollThrough([0, 120], [16, 90], [32, 60], [48, 30], [64, 0]);
    expect(pageBounceY.isAnimating()).toBe(true);
    const furthest = await peak();
    expect(furthest).toBeGreaterThan(20);
    expect(furthest).toBeLessThan(80);
    expect(pageBounceY.get()).toBe(0);
  });

  it('bounces up off the bottom', async () => {
    scrollThrough([0, BOTTOM - 90], [16, BOTTOM - 60], [32, BOTTOM - 30], [48, BOTTOM]);
    expect(await peak()).toBeLessThan(-20);
  });

  it('keeps the fastest fling near the edge', async () => {
    scrollThrough([0, 900], [16, 600], [32, 300], [48, 0]);
    expect(await peak()).toBeLessThan(80);
  });

  it('leaves a slow arrival at the edge', () => {
    scrollThrough([0, 12], [16, 9], [32, 6], [48, 3], [64, 0]);
    expect(pageBounceY.isAnimating()).toBe(false);
  });

  it('reads no speed into two events that land together', () => {
    scrollThrough([0, 12], [16, 9], [32, 6], [33, 3], [34, 0]);
    expect(pageBounceY.isAnimating()).toBe(false);
  });

  it('ignores a jump to the edge', () => {
    scrollThrough([0, 0]);
    scrollThrough([500, 1000], [1000, BOTTOM]);
    expect(pageBounceY.isAnimating()).toBe(false);
  });

  it('waits for the finger to lift', () => {
    const touch = (type: string, touches: unknown[]) => {
      const event = new Event(type);
      Object.defineProperty(event, 'touches', { value: touches });
      window.dispatchEvent(event);
    };
    touch('touchstart', [{}]);
    scrollThrough([0, 90], [16, 60], [32, 30], [48, 0]);
    expect(pageBounceY.isAnimating()).toBe(false);
    touch('touchend', []);
    scrollThrough([1000, 120], [1016, 90], [1032, 60], [1048, 30], [1064, 0]);
    expect(pageBounceY.isAnimating()).toBe(true);
  });

  it('stays still with reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    scrollThrough([0, 90], [16, 60], [32, 30], [48, 0]);
    expect(pageBounceY.isAnimating()).toBe(false);
  });
});
