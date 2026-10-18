import { act, render, screen } from '@testing-library/react';
import type { MotionValue } from 'motion/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

describe('MainPagePager', () => {
  it('mounts a neighbour only for a drag and keeps that instance when its route commits', async () => {
    const view = render(<MainPagePager enabled>Other route</MainPagePager>);
    await screen.findByText('Gallery view');
    expect(screen.queryByText('Search view')).not.toBeInTheDocument();
    act(() => {
      state.controls?.onStart();
      state.controls?.onMove(-200);
    });
    const incoming = await screen.findByText('Search view');
    act(() => state.controls?.onEnd(false, 0, -200));
    expect(state.navigate).not.toHaveBeenCalled();
    act(() => state.complete?.());
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: '/search',
      replace: true,
      resetScroll: false,
      viewTransition: false,
    });
    state.path = '/search';
    view.rerender(<MainPagePager enabled>Other route</MainPagePager>);
    expect(screen.getByText('Search view')).toBe(incoming);
    expect(screen.queryByText('Gallery view')).not.toBeInTheDocument();
  });

  it('does not let an old settling animation navigate after another route opens', async () => {
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
    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.queryByText('Search view')).not.toBeInTheDocument();
  });
});
