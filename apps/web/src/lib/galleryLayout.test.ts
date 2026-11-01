import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { type GalleryScreen, useGalleryLayout } from './galleryLayout';

const SCREENS: GalleryScreen[] = [
  { folded: true, split: false },
  { folded: true, split: true },
  { folded: false, split: false },
  { folded: false, split: true },
];

const layoutOn = (screen: GalleryScreen) =>
  renderHook(() => useGalleryLayout(screen)).result.current[0];

describe('useGalleryLayout', () => {
  beforeEach(() => localStorage.clear());

  it('starts every screen state in masonry', () => {
    for (const screen of SCREENS) expect(layoutOn(screen)).toBe('masonry');
  });

  it('keeps each screen state to its own choice', () => {
    for (const chosen of SCREENS) {
      localStorage.clear();
      const { result } = renderHook(() => useGalleryLayout(chosen));
      act(() => result.current[1]('single-column'));
      for (const screen of SCREENS) {
        expect(layoutOn(screen)).toBe(screen === chosen ? 'single-column' : 'masonry');
      }
    }
  });

  it('keeps the other states when changing one', () => {
    const [folded, , unfolded] = SCREENS as [GalleryScreen, GalleryScreen, GalleryScreen];
    const one = renderHook(() => useGalleryLayout(folded));
    const other = renderHook(() => useGalleryLayout(unfolded));
    act(() => one.result.current[1]('single-column'));
    act(() => other.result.current[1]('single-column'));
    act(() => other.result.current[1]('masonry'));
    expect(layoutOn(folded)).toBe('single-column');
    expect(layoutOn(unfolded)).toBe('masonry');
  });

  it('carries the old single choice to the states that could show it', () => {
    localStorage.setItem('catch-gallery-layout', JSON.stringify('single-column'));
    expect(layoutOn({ folded: true, split: false })).toBe('single-column');
    expect(layoutOn({ folded: false, split: true })).toBe('single-column');
    expect(layoutOn({ folded: false, split: false })).toBe('masonry');
  });

  it('lets a new choice override the old one', () => {
    localStorage.setItem('catch-gallery-layout', JSON.stringify('single-column'));
    const screen = { folded: true, split: false };
    const { result } = renderHook(() => useGalleryLayout(screen));
    act(() => result.current[1]('masonry'));
    expect(layoutOn(screen)).toBe('masonry');
  });

  it('ignores a damaged matrix', () => {
    localStorage.setItem('catch-gallery-layouts', JSON.stringify({ 'folded-page': 'cards' }));
    expect(layoutOn({ folded: true, split: false })).toBe('masonry');
  });
});
