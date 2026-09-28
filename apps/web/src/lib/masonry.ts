export type Point = { x: number; y: number };

type Grid = { columns: number; columnWidth: number; gap: number };

/** Places each card at the top of the shortest column (leftmost on a tie), as Keep does. */
class Columns {
  private readonly tops: number[];

  constructor(private readonly grid: Grid) {
    this.tops = Array.from({ length: grid.columns }, () => 0);
  }

  private shortest() {
    let column = 0;
    for (let i = 1; i < this.tops.length; i++) {
      if ((this.tops[i] ?? 0) < (this.tops[column] ?? 0)) column = i;
    }
    return column;
  }

  /** Where the next card goes. */
  next(): Point {
    const column = this.shortest();
    return { x: column * (this.grid.columnWidth + this.grid.gap), y: this.tops[column] ?? 0 };
  }

  place(height: number): Point {
    const column = this.shortest();
    const slot = this.next();
    this.tops[column] = slot.y + height + this.grid.gap;
    return slot;
  }

  get height() {
    return Math.max(0, Math.max(...this.tops) - this.grid.gap);
  }
}

/** Positions for cards of the given heights, in order, and the height of the whole grid. */
export function masonry(heights: readonly number[], grid: Grid) {
  const columns = new Columns(grid);
  const slots = heights.map((height) => columns.place(height));
  return { slots, height: columns.height };
}

/** How much closer another slot must be before a dragged card leaves its own. */
const HYSTERESIS = 16;

/**
 * Where a dragged card should land: the index among the other cards (`heights`, in
 * order) whose slot is nearest the card's centre. The card keeps its current slot while
 * its centre is over it, so the grid does not flicker between two equally close slots.
 */
export function dropIndex({
  heights,
  height,
  center,
  current,
  ...grid
}: Grid & { heights: readonly number[]; height: number; center: Point; current: number }) {
  const columns = new Columns(grid);
  let best = current;
  let bestDistance = Number.POSITIVE_INFINITY;
  let currentDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= heights.length; index++) {
    const slot = columns.next();
    if (index === current) {
      const inside =
        center.x >= slot.x &&
        center.x <= slot.x + grid.columnWidth &&
        center.y >= slot.y &&
        center.y <= slot.y + height;
      if (inside) return current;
    }
    const distance = Math.hypot(
      center.x - (slot.x + grid.columnWidth / 2),
      center.y - (slot.y + height / 2),
    );
    if (index === current) currentDistance = distance;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    if (index < heights.length) columns.place(heights[index] ?? 0);
  }
  return bestDistance + HYSTERESIS < currentDistance ? best : current;
}
