import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BrandLockup } from './BrandLockup';

const state = vi.hoisted(() => ({ theme: 'light', resize: (_width: number) => {} }));
vi.mock('@/lib/theme', () => ({ useResolvedTheme: () => state.theme }));

beforeEach(() => {
  state.theme = 'light';
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        state.resize = (width) =>
          callback([{ contentRect: { width } } as ResizeObserverEntry], this as ResizeObserver);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it.each(['stable', 'preview', 'dev'] as const)(
  'uses %s artwork in both orientations and themes',
  (channel) => {
    const { rerender } = render(
      <BrandLockup orientation="horizontal" iconSize={48} channel={channel} />,
    );
    expect(screen.getByRole('img', { name: 'Catch' })).toHaveAttribute(
      'src',
      `/wordmark/catch-lockup-horizontal-${channel}-dark.svg`,
    );
    state.theme = 'dark';
    rerender(<BrandLockup orientation="stacked" iconSize={96} channel={channel} />);
    expect(screen.getByRole('img', { name: 'Catch' })).toHaveAttribute(
      'src',
      `/wordmark/catch-lockup-stacked-${channel}-light.svg`,
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
  },
);

it.each([28, 40, 48, 127, 128])('keeps full detail at a %i px displayed icon', (iconSize) => {
  render(<BrandLockup orientation="horizontal" iconSize={iconSize} channel="dev" />);
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmark/catch-lockup-horizontal-dev-dark.svg',
  );
});

it('preserves full detail when shrinking and uses an icon below the revised lockup minimum', () => {
  render(<BrandLockup orientation="horizontal" iconSize={128} channel="preview" />);
  act(() => state.resize(184.34375));
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmark/catch-lockup-horizontal-preview-dark.svg',
  );
  act(() => state.resize(154));
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmark/catch-lockup-horizontal-preview-dark.svg',
  );
  act(() => state.resize(120));
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmark/catch-lockup-horizontal-preview-dark.svg',
  );
  act(() => state.resize(100));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/preview/favicon-mark.svg');
});

it('falls back below the stacked minimum and supports a surface differing from the theme', () => {
  const { rerender } = render(
    <BrandLockup orientation="stacked" iconSize={64} channel="stable" surface="dark" />,
  );
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmark/catch-lockup-stacked-stable-light.svg',
  );
  act(() => state.resize(119));
  expect(screen.getByRole('img')).toHaveAttribute('src', '/icon-small.svg');
  rerender(<BrandLockup orientation="horizontal" iconSize={48} />);
  act(() => state.resize(185));
  expect(screen.getByRole('img')).toHaveAttribute(
    'src',
    '/wordmark/catch-lockup-horizontal-stable-dark.svg',
  );
});
