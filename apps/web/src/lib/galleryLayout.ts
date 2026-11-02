import { z } from 'zod';
import { columnsFor } from './masonry';
import { usePersistentState } from './storage';

/** A grid this wide fills a large screen, where one column would only stretch its cards. */
const LARGE_GRID_COLUMNS = 4;

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
  const columns = columnsFor(gridWidth);
  if (columns === 1) return 'single-column';
  return columns >= LARGE_GRID_COLUMNS ? 'masonry' : null;
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
  // The one choice this replaced was offered only on narrow pages, so a whole unfolded
  // screen never showed it.
  const fallback = folded || split ? previous : 'masonry';
  const forced = forcedGalleryLayout(gridWidth);
  const setLayout = (layout: GalleryLayout) => setMatrix({ ...matrix, [cell]: layout });
  return [forced ?? matrix[cell] ?? fallback, forced ? null : setLayout] as const;
}
