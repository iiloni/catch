import { act, render, screen } from '@testing-library/react';
import type { MotionValue } from 'motion/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pageSwipePosition } from '@/lib/dockState';
import type { usePageSwipe } from '@/lib/pageSwipe';
import { MainPagePager } from './MainPagePager';

const state = vi.hoisted(() => ({
  path: '/',
  controls: null as Parameters<typeof usePageSwipe>[2] | null,
  complete: null as (() => void) | null,
  navigate: vi.fn(),
}));
const router = { navigate: state.navigate, subscribe: () => () => {} };

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => router,
  useRouterState: ({
    select,
  }: {
    select: (value: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: state.path } }),
}));
vi.mock('@/lib/pageSwipe', async () => ({
  ...(await vi.importActual<typeof import('@/lib/pageSwipe')>('@/lib/pageSwipe')),
  usePageSwipe: (
    _surface: unknown,
    _page: unknown,
    controls: Parameters<typeof usePageSwipe>[2],
  ) => {
    state.controls = controls;
  },
}));
vi.mock('motion/react', async () => ({
  ...(await vi.importActual<typeof import('motion/react')>('motion/react')),
  useReducedMotion: () => false,
  animate: (value: MotionValue<number>, to: number, options: { onComplete?: () => void }) => {
    state.complete = () => {
      value.set(to);
      options.onComplete?.();
    };
    return { stop: vi.fn() };
  },
}));
vi.mock('@/routes/_app/-pages/GalleryPage', () => ({ default: () => <div>Gallery view</div> }));
vi.mock('@/routes/_app/-pages/DeckPage', () => ({ default: () => <div>Deck view</div> }));
vi.mock('@/routes/_app/-pages/SearchPage', () => ({ default: () => <div>Search view</div> }));

beforeEach(() => {
  state.path = '/';
  state.controls = null;
  state.complete = null;
  state.navigate.mockClear();
  pageSwipePosition.set(null);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('MainPagePager', () => {
  it('commits the route on release and keeps both pages until the spring arrives', async () => {
    const view = render(<MainPagePager enabled>Other route</MainPagePager>);
    await screen.findByText('Gallery view');
    expect(screen.queryByText('Search view')).not.toBeInTheDocument();
    act(() => {
      state.controls?.onStart();
      state.controls?.onMove(-200);
    });
    const progress = pageSwipePosition.get();
    expect(progress?.get()).toBeCloseTo(1 + 200 / window.innerWidth);
    const incoming = await screen.findByText('Search view');
    const outgoing = screen.getByText('Gallery view');
    act(() => state.controls?.onEnd(false, 0, -200));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/search',
      replace: true,
      resetScroll: false,
      viewTransition: false,
    });
    state.path = '/search';
    view.rerender(<MainPagePager enabled>Other route</MainPagePager>);
    expect(pageSwipePosition.get()).toBe(progress);
    expect(progress?.get()).toBeCloseTo(1 + 200 / window.innerWidth);
    expect(screen.getByText('Search view')).toBe(incoming);
    expect(screen.getByText('Gallery view')).toBe(outgoing);
    act(() => state.complete?.());
    expect(progress?.get()).toBe(2);
    expect(pageSwipePosition.get()).toBeNull();
    expect(screen.getByText('Search view')).toBe(incoming);
    expect(screen.queryByText('Gallery view')).not.toBeInTheDocument();
  });

  it('lets another drag take over the spring from the committed page', async () => {
    const view = render(<MainPagePager enabled>Other route</MainPagePager>);
    await screen.findByText('Gallery view');
    act(() => {
      state.controls?.onStart();
      state.controls?.onMove(-200);
      state.controls?.onEnd(false, 0, -200);
    });
    state.path = '/search';
    view.rerender(<MainPagePager enabled>Other route</MainPagePager>);
    const progress = pageSwipePosition.get();
    const from = progress?.get() ?? 0;
    act(() => {
      state.controls?.onStart();
      state.controls?.onMove(100);
    });
    expect(progress?.get()).toBeCloseTo(from - 100 / window.innerWidth);
    expect(screen.getByText('Gallery view')).toBeInTheDocument();
    act(() => state.controls?.onEnd(false, 0, 100 + (from - 1) * window.innerWidth));
    expect(state.navigate).toHaveBeenLastCalledWith(expect.objectContaining({ to: '/' }));
  });

  it('drops a settling swipe when another route opens instead', async () => {
    const view = render(<MainPagePager enabled>Other route</MainPagePager>);
    await screen.findByText('Gallery view');
    act(() => {
      state.controls?.onStart();
      state.controls?.onMove(-200);
    });
    await screen.findByText('Search view');
    act(() => state.controls?.onEnd(false, 0, -200));
    const finishOldAnimation = state.complete;
    state.path = '/settings/preferences';
    view.rerender(<MainPagePager enabled>Other route</MainPagePager>);
    act(() => finishOldAnimation?.());
    expect(screen.getByText('Other route')).toBeInTheDocument();
    expect(state.navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Search view')).not.toBeInTheDocument();
    expect(pageSwipePosition.get()).toBeNull();
  });

  it('keeps the dock on the spring timeline until a cancelled swipe returns home', async () => {
    render(<MainPagePager enabled>Other route</MainPagePager>);
    await screen.findByText('Gallery view');
    act(() => {
      state.controls?.onStart();
      state.controls?.onMove(-200);
      state.controls?.onEnd(true, 0, -200);
    });
    const progress = pageSwipePosition.get();
    expect(progress?.get()).toBeGreaterThan(1);
    act(() => state.complete?.());
    expect(progress?.get()).toBe(1);
    expect(pageSwipePosition.get()).toBeNull();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
