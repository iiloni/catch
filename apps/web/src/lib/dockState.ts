import { createStore } from './store';

/**
 * The quick-note window above the dock. `saved` briefly shows a check on the
 * compose button after a note is created.
 */
export const quickNote = createStore<'closed' | 'open' | 'saved'>('closed');

/** The search text, kept when leaving the Search tab so returning restores it. */
export const searchQuery = createStore('');

export const TAB_PATHS = ['/deck', '/', '/search'] as const;
export type TabPath = (typeof TAB_PATHS)[number];

/** The tab a page belongs to. Archive and Trash live under the Gallery. */
export function tabFor(pathname: string): TabPath {
  if (pathname.startsWith('/deck')) return '/deck';
  if (pathname.startsWith('/search')) return '/search';
  return '/';
}

/** The tab to return to when search closes. */
export const lastBrowsingTab = createStore<Exclude<TabPath, '/search'>>('/');

/** Where each page sits left to right, so moving between pages slides the right way. */
const PAGE_ORDER: Record<string, number> = {
  '/deck': 0,
  '/': 1,
  '/archive': 1.25,
  '/trash': 1.5,
  '/search': 2,
};

/**
 * The view transition for a navigation: `forward` when moving right through the pages,
 * `back` when moving left, or false for no page transition (opening a note only changes the
 * search params and has its own transition; the quick note should not slide with the page).
 */
export function pageTransition(from: string | undefined, to: string): ['forward' | 'back'] | false {
  const fromOrder = from === undefined ? undefined : PAGE_ORDER[from];
  const toOrder = PAGE_ORDER[to];
  if (fromOrder === undefined || toOrder === undefined || fromOrder === toOrder) return false;
  if (quickNote.get() === 'open') return false;
  return [toOrder > fromOrder ? 'forward' : 'back'];
}
