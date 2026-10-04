import { useRouterState } from '@tanstack/react-router';
import { type MotionValue, motionValue, useTransform } from 'motion/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createStore } from './store';

/**
 * On tablets and unfolded foldables an open note sits in a pane beside the page instead of
 * covering it. Landscape phones are wide enough but too short for two panes.
 */
const MIN_WIDTH = 672;
const MIN_HEIGHT = 480;
/** The page keeps room for a column of cards, the note for comfortable lines. */
export const LIST_MIN = 280;
export const NOTE_MIN = 340;
/** The widest a page of cards gets (`max-w-7xl`), and a page of results (`max-w-2xl`). */
export const PAGE_MAX = 1280;
export const READING_MAX = 672;
/** Space between the page and the note, which holds the resize handle. */
export const GUTTER = 24;
const DEFAULT_RATIO = 0.42;
const STORAGE_KEY = 'catch-split';

export type Viewport = { width: number; height: number };

/**
 * The Deck's columns need the whole width to be worth having, so a note opened there pops up
 * over it instead. The Gallery pages and Search are lists to pick from, which suit a split.
 */
const UNSPLIT_PAGES = new Set(['/deck']);

export function canSplit({ width, height }: Viewport, pathname: string) {
  return width >= MIN_WIDTH && height >= MIN_HEIGHT && !UNSPLIT_PAGES.has(pathname);
}

/** How wide the page may be beside a note, in CSS pixels. */
export function listWidthLimits(viewport: number) {
  const max = Math.max(LIST_MIN, Math.min(viewport * 0.7, viewport - GUTTER - NOTE_MIN));
  const min = Math.min(max, Math.max(LIST_MIN, viewport * 0.25));
  return { min, max };
}

export function listWidthFor(ratio: number, viewport: number) {
  const { min, max } = listWidthLimits(viewport);
  return Math.round(Math.min(max, Math.max(min, ratio * viewport)));
}

function storedRatio() {
  const value = Number(localStorage.getItem(STORAGE_KEY));
  return value > 0 && value < 1 ? value : DEFAULT_RATIO;
}

/**
 * The page's share of the screen beside a note. A share rather than pixels, so the split
 * survives rotating or unfolding the device. Saved with `saveListRatio` once a drag ends.
 */
export const listRatio = createStore(storedRatio());

export function saveListRatio() {
  localStorage.setItem(STORAGE_KEY, String(listRatio.get()));
}

/** The note open in the pane, whose card the page marks. */
export const paneNoteId = createStore<string | null>(null);

/**
 * How far the pane has slid in from the right edge: 0 off screen, 1 in place. The editor
 * drives it; fixed UI over the page follows it through `--note-pane`.
 */
export const paneReveal = motionValue(0);

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return viewport;
}

export type NotePane = {
  /** The screen is wide enough to show a note beside the page. */
  split: boolean;
  /** A note is open beside the page, which is narrowed for it. */
  shown: boolean;
  listWidth: number;
  /** The pane's width, gutter included. */
  noteWidth: number;
  viewport: Viewport;
};

export function useNotePane(): NotePane {
  const viewport = useViewport();
  const ratio = listRatio.use();
  // The page as rendered: `location` runs ahead of it while a navigation resolves, and a note
  // leaving for the Deck must still be closing in a pane when the Deck's path arrives.
  const noteOpen = useRouterState({
    select: (state) =>
      Boolean((state.matches.at(-1)?.search as { note?: string } | undefined)?.note),
  });
  const pathname = useRouterState({ select: (state) => state.matches.at(-1)?.pathname ?? '/' });
  const split = canSplit(viewport, pathname);
  const listWidth = listWidthFor(ratio, viewport.width);
  return {
    split,
    shown: split && noteOpen,
    listWidth,
    noteWidth: viewport.width - listWidth,
    viewport,
  };
}

/**
 * Publishes how much of the screen the pane covers as `--note-pane`, which fixed UI over the
 * page (headers, the dock, the quick note) leaves free on the right. It follows the pane as
 * it slides; the page itself takes its new width at once, so its cards move only once. Called
 * once, by the app layout.
 */
export function useNotePaneLayout(): NotePane {
  const pane = useNotePane();
  const width = pane.split ? pane.noteWidth : 0;
  useLayoutEffect(() => {
    const root = document.documentElement;
    const update = () => root.style.setProperty('--note-pane', `${width * paneReveal.get()}px`);
    update();
    return paneReveal.on('change', update);
  }, [width]);
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-note-pane', pane.shown);
  }, [pane.shown]);
  return pane;
}

/**
 * A page narrower than the screen is centered, with gutters either side. It takes its new
 * width at once when the pane opens or closes, which would move it to its new gutter in one
 * step, or to none at all. This is the offset that keeps it where the gutter was and brings
 * it across over the whole of the pane's slide. `maxWidth` is the page's, in pixels.
 *
 * The gutter is not what centering in the space the pane leaves would give: that one runs
 * out while the pane is still part of the way in, which packed the page's whole move into
 * the fastest stretch of an opening slide and the slowest of a closing one.
 *
 * Put it on the page's content, never around a fixed header: it is a transform while the
 * pane slides (and none at rest, so a held card still rides above the header).
 */
export function usePageGutterShift(maxWidth: number): MotionValue<number> {
  const { sliding, rest } = useGutters(maxWidth);
  return useTransform(() => sliding(paneReveal.get()) - rest);
}

/**
 * The same for what sits at the left of a fixed header, which does center itself in the
 * space the pane leaves: the offset from there to where the page's content is.
 */
export function useHeaderGutterShift(maxWidth: number): MotionValue<number> {
  const { sliding, centered } = useGutters(maxWidth);
  return useTransform(() => {
    const reveal = paneReveal.get();
    return sliding(reveal) - centered(reveal);
  });
}

function useGutters(maxWidth: number) {
  const pane = useNotePane();
  const covered = pane.split ? pane.noteWidth : 0;
  const screen = pane.viewport.width;
  const gutter = (pane: number) => Math.max(0, (screen - pane - maxWidth) / 2);
  return {
    /** The gutter of a page that crosses evenly with the pane. */
    sliding: (reveal: number) => gutter(0) + (gutter(covered) - gutter(0)) * reveal,
    /** The gutter of something centered in what the pane leaves of the screen. */
    centered: (reveal: number) => gutter(covered * reveal),
    rest: gutter(pane.shown ? pane.noteWidth : 0),
  };
}
