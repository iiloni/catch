import { createStore } from './store';

/**
 * The quick-note window above the dock. `saved` briefly shows a check on the
 * compose button after a note is created.
 */
export const quickNote = createStore<'closed' | 'open' | 'saved'>('closed');

/** The search text, kept when leaving the Search tab so returning restores it. */
export const searchQuery = createStore('');

export const TAB_PATHS = ['/', '/deck', '/search'] as const;
export type TabPath = (typeof TAB_PATHS)[number];

/** The tab a page belongs to. Archive and Trash live under the Gallery. */
export function tabFor(pathname: string): TabPath {
  if (pathname.startsWith('/deck')) return '/deck';
  if (pathname.startsWith('/search')) return '/search';
  return '/';
}

/** The tab to return to when search closes. */
export const lastBrowsingTab = createStore<Exclude<TabPath, '/search'>>('/');
