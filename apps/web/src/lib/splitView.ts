import { useRouterState } from '@tanstack/react-router';
import { type MotionValue, motionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { GALLERY_PAGES } from './galleryPages';
import { afterPaint, animateSteadySpring, springs, stopSteady } from './motion';
import { usePersistentState } from './storage';
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
/** Narrow note panes put undo and redo above the dock so header actions still fit. */
export const HEADER_HISTORY_MIN = 480;
/** The widest a page of cards gets (`max-w-7xl`), and a page of results (`max-w-2xl`). */
export const PAGE_MAX = 1280;
export const READING_MAX = 672;
/** Space between the page and the note, which holds the resize handle. */
export const GUTTER = 24;
const DEFAULT_RATIO = 0.42;
const STORAGE_KEY = 'catch-split';
const expandedSchema = z.boolean();

export function useGalleryExpanded() {
  return usePersistentState('catch-gallery-expanded', expandedSchema, false);
}

/** Shared by the note surface and its dock. */
export const paneExpansion = motionValue(0);
/** The Gallery fades in place while the note takes its width. */
export const galleryOpacity = motionValue(1);

const watchExpansion = (listener: () => void) => paneExpansion.on('change', listener);

/** Reflow header tools and sidebars only when the moving pane has room for them. */
export function usePaneWidthAtLeast(width: number, gained: number, minimum: number) {
  return useSyncExternalStore(
    watchExpansion,
    () => width + gained * paneExpansion.get() >= minimum,
  );
}

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

function viewportSize(): Viewport {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

export function useViewport(): Viewport {
  const [viewport, setViewport] = useState(viewportSize);
  useEffect(() => {
    let frame = 0;
    const update = () =>
      setViewport((previous) => {
        const next = viewportSize();
        return previous.width === next.width && previous.height === next.height ? previous : next;
      });
    const resize = () => {
      update();
      // The root's client size stays within the screen while mobile innerWidth can briefly
      // include content from before a fold. Recheck after that content paints too.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('resize', resize);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    observer?.observe(document.documentElement);
    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  return viewport;
}

export type NotePane = {
  /** A Gallery pane can take the page's width while keeping its card and toolbars. */
  expandable: boolean;
  expanded: boolean;
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
  const [expanded] = useGalleryExpanded();
  const ratio = listRatio.use();
  // The page as rendered: `location` runs ahead of it while a navigation resolves, and a note
  // leaving for the Deck must still be closing in a pane when the Deck's path arrives.
  const noteOpen = useRouterState({
    select: (state) =>
      Boolean((state.matches.at(-1)?.search as { note?: string } | undefined)?.note),
  });
  const pathname = useRouterState({ select: (state) => state.matches.at(-1)?.pathname ?? '/' });
  const split = canSplit(viewport, pathname);
  const expandable = split && GALLERY_PAGES.some((page) => page === pathname);
  const listWidth = listWidthFor(ratio, viewport.width);
  return {
    expandable,
    expanded: expandable && expanded,
    split,
    shown: split && noteOpen,
    listWidth,
    noteWidth: viewport.width - listWidth,
    viewport,
  };
}

/**
 * Publishes the ordinary split width as `--note-pane`, which fixed UI over the
 * page (headers, the dock, the quick note) leaves free on the right. It follows the pane as
 * it slides; the page itself takes its new width at once, so its cards move only once. Called
 * once, by the app layout.
 */
export function useNotePaneLayout(): NotePane & { covered: boolean } {
  const pane = useNotePane();
  const [covered, setCovered] = useState(false);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const target = pane.expanded ? 1 : 0;
    const update = () =>
      setCovered(pane.expanded && paneExpansion.get() === 1 && paneReveal.get() === 1);
    const stop = paneExpansion.on('change', update);
    const stopReveal = paneReveal.on('change', update);
    if (reducedMotion || !pane.split || paneReveal.get() === 0) {
      paneExpansion.jump(target);
      update();
      return () => {
        stop();
        stopReveal();
      };
    }
    update();
    // Reflowing the header can occupy the first frame. Keep that work out of the spring's
    // time, as when opening a pane; a reversal continues from its current width.
    const cancel = afterPaint(() => {
      void animateSteadySpring(paneExpansion, target, springs.pane);
    });
    return () => {
      stop();
      stopReveal();
      cancel();
      stopSteady(paneExpansion);
    };
  }, [pane.expanded, pane.split, reducedMotion]);
  const width = pane.split ? pane.noteWidth : 0;
  useLayoutEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const covered = width + (pane.split ? pane.listWidth * paneExpansion.get() : 0);
      const reveal = paneReveal.get();
      root.style.setProperty('--note-pane', `${width * reveal}px`);
      root.style.setProperty('--expanded-note-pane', `${covered * reveal}px`);
      const opacity = pane.split ? 1 - paneExpansion.get() * reveal : 1;
      galleryOpacity.set(opacity);
      root.style.setProperty('--gallery-opacity', String(opacity));
    };
    update();
    const stopReveal = paneReveal.on('change', update);
    const stopExpansion = paneExpansion.on('change', update);
    return () => {
      stopReveal();
      stopExpansion();
    };
  }, [width, pane.split, pane.listWidth]);
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-note-pane', pane.shown);
  }, [pane.shown]);
  return { ...pane, covered };
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
