export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Transform = Point & { scale: number };

export const initialTransform: Transform = { scale: 1, x: 0, y: 0 };

export function fittedSize(image: Size, viewport: Size, fill: boolean): Size {
  if (!image.width || !image.height) return { width: 0, height: 0 };
  const ratios = [
    Math.max(1, viewport.width - 32) / image.width,
    Math.max(1, viewport.height - 32) / image.height,
  ];
  const ratio = fill ? Math.max(...ratios) : Math.min(...ratios);
  return { width: image.width * ratio, height: image.height * ratio };
}

export function constrain(transform: Transform, media: Size, viewport: Size): Transform {
  const scale = Math.max(1, Math.min(8, transform.scale));
  const limitX = Math.max(0, (media.width * scale - viewport.width) / 2);
  const limitY = Math.max(0, (media.height * scale - viewport.height) / 2);
  return {
    scale,
    x: limitX ? Math.max(-limitX, Math.min(limitX, transform.x)) : 0,
    y: limitY ? Math.max(-limitY, Math.min(limitY, transform.y)) : 0,
  };
}

// Keep the same image point under the cursor or between moving fingers.
export function zoomAt(transform: Transform, scale: number, from: Point, to = from): Transform {
  const nextScale = Math.max(1, Math.min(8, scale));
  const ratio = nextScale / transform.scale;
  return {
    scale: nextScale,
    x: to.x - (from.x - transform.x) * ratio,
    y: to.y - (from.y - transform.y) * ratio,
  };
}
