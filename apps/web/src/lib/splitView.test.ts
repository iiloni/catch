import { describe, expect, it } from 'vitest';
import { canSplit, GUTTER, LIST_MIN, listWidthFor, listWidthLimits, NOTE_MIN } from './splitView';

describe('splitView', () => {
  it('splits on tablets and unfolded foldables, not on phones', () => {
    expect(canSplit({ width: 412, height: 915 }, '/')).toBe(false);
    // A phone on its side is wide but too short for two panes.
    expect(canSplit({ width: 915, height: 412 }, '/')).toBe(false);
    expect(canSplit({ width: 690, height: 830 }, '/')).toBe(true);
    expect(canSplit({ width: 1180, height: 820 }, '/')).toBe(true);
  });

  it('splits beside the Gallery pages and Search, not the Deck', () => {
    const tablet = { width: 1180, height: 820 };
    for (const page of ['/', '/archive', '/trash', '/search']) {
      expect(canSplit(tablet, page)).toBe(true);
    }
    expect(canSplit(tablet, '/deck')).toBe(false);
  });

  it('leaves both panes their minimum width', () => {
    for (const viewport of [690, 820, 1180, 1920]) {
      const { min, max } = listWidthLimits(viewport);
      expect(min).toBeGreaterThanOrEqual(LIST_MIN);
      expect(viewport - GUTTER - max).toBeGreaterThanOrEqual(NOTE_MIN);
      expect(min).toBeLessThanOrEqual(max);
    }
  });

  it('keeps the page between a quarter and 70% of wide screens', () => {
    expect(listWidthLimits(1920)).toEqual({ min: 480, max: 1344 });
  });

  it('clamps the stored share to the limits', () => {
    expect(listWidthFor(0.5, 1200)).toBe(600);
    expect(listWidthFor(0.05, 1200)).toBe(listWidthLimits(1200).min);
    expect(listWidthFor(0.95, 1200)).toBe(listWidthLimits(1200).max);
  });
});
