import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { forcedGalleryLayout, type GalleryScreen, useGalleryLayout } from './galleryLayout';

/** Room for a choice: more than one column, and not a large screen's. */
const GRID = 500;

const SCREENS: GalleryScreen[] = [
  { folded: true, split: false },
  { folded: true, split: true },
  { folded: false, split: false },
  { folded: false, split: true },
];

const layoutOn = (screen: GalleryScreen, width = GRID) =>
  renderHook(() => useGalleryLayout(screen, width)).result.current[0];

const choose = (screen: GalleryScreen, layout: 'masonry' | 'single-column') => {
  const { result } = renderHook(() => useGalleryLayout(screen, GRID));
  act(() => result.current[1]?.(layout));
};

describe('forcedGalleryLayout', () => {
  it('leaves a single column to a grid too narrow for two', () => {
    expect(forcedGalleryLayout(279)).toBe('single-column');
  });

  it('leaves the choice to widths between', () => {
    expect(forcedGalleryLayout(280)).toBeNull();
    expect(forcedGalleryLayout(591)).toBeNull();
  });

  it('keeps wider grids in masonry', () => {
    expect(forcedGalleryLayout(592)).toBe('masonry');
    // The narrowest whole page on a screen that can split: 672 px less its gutters.
    expect(forcedGalleryLayout(624)).toBe('masonry');
    expect(forcedGalleryLayout(1232)).toBe('masonry');
  });
});

describe('useGalleryLayout', () => {
  beforeEach(() => localStorage.clear());

  it('starts every screen state in masonry', () => {
    for (const screen of SCREENS) expect(layoutOn(screen)).toBe('masonry');
  });

  it('keeps each screen state to its own choice', () => {
    for (const chosen of SCREENS) {
      localStorage.clear();
      choose(chosen, 'single-column');
      for (const screen of SCREENS) {
        expect(layoutOn(screen)).toBe(screen === chosen ? 'single-column' : 'masonry');
      }
    }
  });

  it('keeps the other states when changing one', () => {
    const [folded, , unfolded] = SCREENS as [GalleryScreen, GalleryScreen, GalleryScreen];
    choose(folded, 'single-column');
    choose(unfolded, 'single-column');
    choose(unfolded, 'masonry');
    expect(layoutOn(folded)).toBe('single-column');
    expect(layoutOn(unfolded)).toBe('masonry');
  });

  it('offers no choice where the width decides, and keeps the saved one for later', () => {
    const screen = { folded: false, split: true };
    choose(screen, 'single-column');
    for (const [width, layout] of [
      [1232, 'masonry'],
      [242, 'single-column'],
    ] as const) {
      const { result } = renderHook(() => useGalleryLayout(screen, width));
      expect(result.current[0]).toBe(layout);
      expect(result.current[1]).toBeNull();
    }
    expect(layoutOn(screen)).toBe('single-column');
  });

  it('carries the old single choice over', () => {
    localStorage.setItem('catch-gallery-layout', JSON.stringify('single-column'));
    expect(layoutOn({ folded: true, split: false })).toBe('single-column');
    expect(layoutOn({ folded: false, split: true })).toBe('single-column');
  });

  it('lets a new choice override the old one', () => {
    localStorage.setItem('catch-gallery-layout', JSON.stringify('single-column'));
    const screen = { folded: true, split: false };
    choose(screen, 'masonry');
    expect(layoutOn(screen)).toBe('masonry');
  });

  it('ignores a damaged matrix', () => {
    localStorage.setItem('catch-gallery-layouts', JSON.stringify({ 'folded-page': 'cards' }));
    expect(layoutOn({ folded: true, split: false })).toBe('masonry');
  });
});
