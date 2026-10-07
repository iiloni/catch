import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pageBounceY, watchScrollBounce } from './scrollBounce';

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
  stop = watchScrollBounce();
});

afterEach(() => {
  stop();
  vi.restoreAllMocks();
});

describe('watchScrollBounce', () => {
  it('carries a fling into the top on past it, then back', async () => {
    scrollThrough([0, 120], [16, 90], [32, 60], [48, 30], [64, 0]);
    expect(pageBounceY.isAnimating()).toBe(true);
    const furthest = await peak();
    expect(furthest).toBeGreaterThan(10);
    expect(furthest).toBeLessThan(40);
    expect(pageBounceY.get()).toBe(0);
  });

  it('bounces up off the bottom', async () => {
    scrollThrough([0, BOTTOM - 90], [16, BOTTOM - 60], [32, BOTTOM - 30], [48, BOTTOM]);
    expect(await peak()).toBeLessThan(-10);
  });

  it('keeps the fastest fling near the edge', async () => {
    scrollThrough([0, 900], [16, 600], [32, 300], [48, 0]);
    expect(await peak()).toBeLessThan(40);
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

  describe('inside a scroller', () => {
    function scroller(height = 400) {
      const list = document.createElement('ul');
      const row = document.createElement('li');
      list.append(row);
      document.body.append(list);
      vi.spyOn(list, 'scrollHeight', 'get').mockReturnValue(2000);
      vi.spyOn(list, 'clientHeight', 'get').mockReturnValue(height);
      const animate = vi.fn().mockReturnValue({ cancel: vi.fn() });
      row.animate = animate;
      const scrollTo = (...steps: [number, number][]) => {
        for (const [time, y] of steps) {
          list.scrollTop = y;
          // As the browser sends it: to the scroller alone, without bubbling.
          const event = new Event('scroll');
          Object.defineProperty(event, 'timeStamp', { value: time });
          list.dispatchEvent(event);
        }
      };
      /** The furthest the latest bounce moves the row. */
      const reach = () => {
        const frames: { transform: string }[] = animate.mock.lastCall?.[0] ?? [];
        const offsets = frames.map((frame) => Number.parseFloat(frame.transform.slice(11)));
        return offsets.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
      };
      return { list, animate, scrollTo, reach };
    }

    afterEach(() => document.body.replaceChildren());

    it('bounces its content and leaves the page alone', () => {
      const { animate, scrollTo, reach } = scroller();
      scrollTo([0, 120], [16, 90], [32, 60], [48, 30], [64, 0]);
      expect(animate).toHaveBeenCalledOnce();
      expect(animate.mock.lastCall?.[1]).toMatchObject({ composite: 'add' });
      expect(reach()).toBeGreaterThan(10);
      expect(animate.mock.lastCall?.[0].at(-1)).toEqual({ transform: 'translateY(0.00px)' });
      expect(pageBounceY.isAnimating()).toBe(false);
    });

    it('bounces up off its bottom', () => {
      const { scrollTo, reach } = scroller();
      scrollTo([0, 1480], [16, 1510], [32, 1540], [48, 1570], [64, 1600]);
      expect(reach()).toBeLessThan(-10);
    });

    it('moves a small scroller less', () => {
      const { scrollTo, reach } = scroller(100);
      scrollTo([0, 900], [16, 600], [32, 300], [48, 0]);
      expect(reach()).toBeGreaterThan(0);
      expect(reach()).toBeLessThanOrEqual(12);
    });

    it('leaves a slow arrival and a sideways scroll alone', () => {
      const { list, animate, scrollTo } = scroller();
      scrollTo([0, 12], [16, 9], [32, 6], [48, 3], [64, 0]);
      for (const time of [1000, 1016, 1032, 1048]) {
        list.scrollLeft += 40;
        const event = new Event('scroll');
        Object.defineProperty(event, 'timeStamp', { value: time });
        list.dispatchEvent(event);
      }
      expect(animate).not.toHaveBeenCalled();
    });
  });
});
