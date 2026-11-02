import { z } from 'zod';
import { columnsFor } from './masonry';
import { usePersistentState } from './storage';

/**
 * From here one column would only stretch its cards. A 640 px page less its gutters, which is
 * under what any screen that can split gives a whole page, so unfolded pages stay in masonry.
 */
const LARGE_GRID_WIDTH = 592;

const layoutSchema = z.enum(['masonry', 'single-column']);
export type GalleryLayout = z.infer<typeof layoutSchema>;

const matrixSchema = z.partialRecord(
  z.enum(['folded-page', 'folded-split', 'unfolded-page', 'unfolded-split']),
  layoutSchema,
);

export type GalleryScreen = {
  /** The screen is too small for two panes (`isFolded`). */
  folded: boolean;
  /** A note is open beside the page. */
  split: boolean;
};

/** The layout a grid of this width has to use, if it leaves any choice at all. */
export function forcedGalleryLayout(gridWidth: number): GalleryLayout | null {
  if (gridWidth >= LARGE_GRID_WIDTH) return 'masonry';
  return columnsFor(gridWidth) === 1 ? 'single-column' : null;
}

/**
 * The Gallery's layout for the screen as it is now, and the setter where it can be chosen.
 * Each combination keeps its own choice, because the page is a different size in each: one
 * made beside a note says nothing about the folded phone or the whole unfolded screen.
 */
export function useGalleryLayout({ folded, split }: GalleryScreen, gridWidth: number) {
  const [previous] = usePersistentState('catch-gallery-layout', layoutSchema, 'masonry');
  const [matrix, setMatrix] = usePersistentState('catch-gallery-layouts', matrixSchema, {});
  const cell = `${folded ? 'folded' : 'unfolded'}-${split ? 'split' : 'page'}` as const;
  const forced = forcedGalleryLayout(gridWidth);
  const setLayout = (layout: GalleryLayout) => setMatrix({ ...matrix, [cell]: layout });
  return [forced ?? matrix[cell] ?? previous, forced ? null : setLayout] as const;
}
