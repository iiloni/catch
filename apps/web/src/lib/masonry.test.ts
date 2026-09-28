import { describe, expect, it } from 'vitest';
import { dropIndex, masonry } from './masonry';

const grid = { columns: 2, columnWidth: 100, gap: 10 };

describe('masonry', () => {
  it('puts each card at the top of the shortest column', () => {
    const { slots, height } = masonry([100, 50, 60, 40], grid);
    expect(slots).toEqual([
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 60 },
      { x: 0, y: 110 },
    ]);
    expect(height).toBe(150);
  });

  it('is empty without cards', () => {
    expect(masonry([], grid)).toEqual({ slots: [], height: 0 });
  });
});

describe('dropIndex', () => {
  // Others at: 0 → (0, 0), 1 → (110, 0), 2 → (0, 60); then slot 3 is (110, 60).
  const heights = [50, 50, 50];
  const drop = (center: { x: number; y: number }, current: number) =>
    dropIndex({ ...grid, heights, height: 50, center, current });

  it('keeps the slot the card is still over', () => {
    expect(drop({ x: 50, y: 25 }, 0)).toBe(0);
  });

  it('moves to the slot nearest the card', () => {
    expect(drop({ x: 160, y: 85 }, 0)).toBe(3);
    expect(drop({ x: 160, y: 25 }, 0)).toBe(1);
  });

  it('stays put when another slot is barely closer', () => {
    // Just past the bottom of slot 0, and only slightly nearer slot 2.
    expect(drop({ x: 50, y: 58 }, 0)).toBe(0);
  });
});
