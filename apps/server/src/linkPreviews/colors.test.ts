import { describe, expect, it } from 'vitest';
import { colorHue, dominantHue, parseCssColor } from './colors';

describe('parseCssColor', () => {
  it('reads hex, rgb and hsl', () => {
    expect(parseCssColor('#f50')).toEqual([255, 85, 0]);
    expect(parseCssColor('#FF550080')).toEqual([255, 85, 0]);
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseCssColor('rgba(10 20 30 / 50%)')).toEqual([10, 20, 30]);
    expect(parseCssColor('hsl(0, 100%, 50%)')?.map(Math.round)).toEqual([255, 0, 0]);
  });

  it('rejects what it cannot read', () => {
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('#12')).toBeNull();
    expect(parseCssColor('rgb(a, b, c)')).toBeNull();
  });
});

describe('colorHue', () => {
  it('gives an OKLCH hue for colors and null for grays', () => {
    expect(colorHue([255, 0, 0])).toBe(29);
    expect(colorHue([0, 0, 255])).toBe(264);
    expect(colorHue([255, 255, 255])).toBeNull();
    expect(colorHue([36, 41, 47])).toBeNull();
  });
});

function pixels(...colors: Array<[number, number, number, number, number]>) {
  const data: number[] = [];
  for (const [r, g, b, a, count] of colors) {
    for (let i = 0; i < count; i += 1) data.push(r, g, b, a);
  }
  return new Uint8Array(data);
}

describe('dominantHue', () => {
  it('finds a logo color on a white background', () => {
    const hue = dominantHue(pixels([255, 255, 255, 255, 80], [0, 0, 255, 255, 20]));
    expect(hue).toBeGreaterThan(255);
    expect(hue).toBeLessThan(270);
  });

  it('ignores transparent pixels and gives null for monochrome icons', () => {
    expect(dominantHue(pixels([255, 0, 0, 0, 90], [20, 20, 20, 255, 10]))).toBeNull();
  });
});
