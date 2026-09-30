import { describe, expect, it } from 'vitest';
import { constrain, fittedSize, initialTransform, zoomAt } from './transform';

describe('media transforms', () => {
  it('fits a portrait completely or fills the viewport without changing its aspect ratio', () => {
    const image = { width: 400, height: 1200 };
    const viewport = { width: 832, height: 632 };
    expect(fittedSize(image, viewport, false)).toEqual({ width: 200, height: 600 });
    expect(fittedSize(image, viewport, true)).toEqual({ width: 800, height: 2400 });
  });

  it('keeps the same image point beneath a zoom focal point', () => {
    const before = { scale: 2, x: -100, y: 40 };
    const cursor = { x: 150, y: -30 };
    const after = zoomAt(before, 4, cursor);
    expect((cursor.x - after.x) / after.scale).toBe((cursor.x - before.x) / before.scale);
    expect((cursor.y - after.y) / after.scale).toBe((cursor.y - before.y) / before.scale);
  });

  it('follows the moving midpoint during pinch and bounds the zoom range', () => {
    expect(zoomAt(initialTransform, 2, { x: 20, y: 10 }, { x: 60, y: 40 })).toEqual({
      scale: 2,
      x: 20,
      y: 20,
    });
    expect(zoomAt(initialTransform, 100, { x: 0, y: 0 }).scale).toBe(8);
    expect(zoomAt(initialTransform, 0.1, { x: 0, y: 0 }).scale).toBe(1);
  });

  it('prevents dragging an image offscreen and recenters axes smaller than the viewport', () => {
    const media = { width: 400, height: 600 };
    const viewport = { width: 800, height: 600 };
    expect(constrain({ scale: 3, x: -900, y: 900 }, media, viewport)).toEqual({
      scale: 3,
      x: -200,
      y: 600,
    });
    expect(constrain({ scale: 1, x: 40, y: -90 }, media, viewport)).toEqual(initialTransform);
    // Rotation to a wider viewport makes its newly visible horizontal axis recenter.
    expect(constrain({ scale: 3, x: -200, y: 600 }, media, { width: 1400, height: 600 })).toEqual({
      scale: 3,
      x: 0,
      y: 600,
    });
  });
});
