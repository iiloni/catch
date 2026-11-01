import { z } from 'zod';
import { usePersistentState } from './storage';

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

/**
 * The Gallery's layout for the screen as it is now. Each combination keeps its own, because
 * the page is a different size in each: a choice made beside a note says nothing about the
 * folded phone or the whole unfolded screen.
 */
export function useGalleryLayout({ folded, split }: GalleryScreen) {
  const [previous] = usePersistentState('catch-gallery-layout', layoutSchema, 'masonry');
  const [matrix, setMatrix] = usePersistentState('catch-gallery-layouts', matrixSchema, {});
  const cell = `${folded ? 'folded' : 'unfolded'}-${split ? 'split' : 'page'}` as const;
  // The one choice this replaced was offered only on narrow pages, so a whole unfolded
  // screen never showed it.
  const fallback = folded || split ? previous : 'masonry';
  const setLayout = (layout: GalleryLayout) => setMatrix({ ...matrix, [cell]: layout });
  return [matrix[cell] ?? fallback, setLayout] as const;
}
