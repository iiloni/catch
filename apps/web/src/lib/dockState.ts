import type { Note } from '@catch/shared';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { isSettingsPath, isWideSettings, SETTINGS_TABS } from './settings';
import { createStore } from './store';

/**
 * The quick-note window above the dock. `capture` keeps its editor while saving a link.
 * `saved` briefly shows a check on the
 * compose button after a note is created.
 */
export const quickNote = createStore<'closed' | 'open' | 'capture' | 'saved'>('closed');
export const quickNoteCanSave = createStore(false);

/** The search text, kept when leaving the Search tab so returning restores it. */
export const searchQuery = createStore('');
export const searchFiltersOpen = createStore(false);
export const searchFilterCount = createStore(0);

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
  ...Object.fromEntries(SETTINGS_TABS.map((tab, index) => [tab.path, 3 + index / 10])),
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
  // Side by side, Settings' page list stays put while the page beside it changes.
  if (from && isSettingsPath(from) && isSettingsPath(to) && isWideSettings(window.innerWidth)) {
    return false;
  }
  return [toOrder > fromOrder ? 'forward' : 'back'];
}

/**
 * The note shown in the editor, and a handle on its editor. While a note is open the dock
 * becomes its toolbar (and its formatting bar while typing); the editor publishes these.
 */
export const editorNote = createStore<Note | null>(null);
export const editorControls = createStore<EditorControls | null>(null);

/** The open note's dock has grown upward into its palette or the Deck's columns. */
export const noteDockPanelOpen = createStore(false);
