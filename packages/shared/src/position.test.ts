import { describe, expect, it } from 'vitest';
import { notePositionSchema } from './notes';
import { comparePositions, positionBetween, positionsBetween } from './position';

describe('positionBetween', () => {
  it('sorts between its bounds by code unit', () => {
    const first = positionBetween(null, null);
    const before = positionBetween(null, first);
    const after = positionBetween(first, null);
    const middle = positionBetween(before, first);
    expect([after, first, middle, before].sort(comparePositions)).toEqual([
      before,
      middle,
      first,
      after,
    ]);
    for (const position of [first, before, after, middle]) {
      expect(notePositionSchema.safeParse(position).success).toBe(true);
    }
  });

  it('places after equal bounds instead of throwing', () => {
    expect(comparePositions(positionBetween('a0', 'a0'), 'a0')).toBe(1);
  });

  it('keeps finding room between neighbours', () => {
    const low = 'a0';
    let high = 'a1';
    for (let i = 0; i < 200; i++) high = positionBetween(low, high);
    expect(comparePositions(low, high)).toBe(-1);
  });
});

describe('positionsBetween', () => {
  it('hands out ordered positions before the first note', () => {
    const first = positionBetween(null, null);
    const keys = positionsBetween(null, first, 3);
    expect(keys).toHaveLength(3);
    expect([...keys, first].sort(comparePositions)).toEqual([...keys, first]);
  });
});
