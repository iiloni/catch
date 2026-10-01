import {
  type AnyRouter,
  type ParsedLocation,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { useCallback } from 'react';
import { type Rect, setOrigin } from './noteTransition';

/** The note whose editor was opened by pushing a history entry in this session. */
let pushedNoteId: string | null = null;

/**
 * A note opens over the page it was opened from, so these navigations leave that page's
 * scroll alone. The router otherwise scrolls to the top after every navigation, which moves
 * the card out from under the editor growing out of it.
 */
const IN_PLACE = { replace: true, resetScroll: false } as const;

const noteOf = (location: ParsedLocation) => (location.search as { note?: string }).note;

/**
 * Going back (the gesture, or `close` below) is a navigation that cannot be told to leave
 * the scroll alone: the router scrolls the page to the top, and the browser only puts it
 * back some frames later, with the editor already shrinking towards where its card is not.
 * This holds the page still across any navigation that only opens, swaps or closes a note.
 */
export function keepScrollAcrossNotes(router: AnyRouter) {
  let held: { left: number; top: number } | null = null;
  router.subscribe('onBeforeLoad', ({ fromLocation, toLocation, pathChanged }) => {
    const sameNote = !fromLocation || noteOf(fromLocation) === noteOf(toLocation);
    held = pathChanged || sameNote ? null : { left: window.scrollX, top: window.scrollY };
  });
  router.subscribe('onRendered', () => {
    const position = held;
    held = null;
    // In a microtask, so it follows the router's own scrolling whichever listener runs first.
    if (position) queueMicrotask(() => window.scrollTo({ ...position, behavior: 'instant' }));
  });
}

/**
 * The open note lives in the `note` search param, so the Android back gesture and
 * browser history close the editor, and an open note survives a reload.
 */
export function useOpenNote() {
  const navigate = useNavigate();
  const router = useRouter();

  /** Opens a note, growing the editor out of `source` (usually the note's card). */
  const open = useCallback(
    (id: string, source?: Element | Rect) => {
      const current = new URLSearchParams(window.location.search).get('note');
      if (current === id) return;
      if (source) setOrigin(id, source);
      // Switching notes (in the pane beside the page) swaps the entry, so back still closes
      // the note in one step and never walks through every note opened on the way.
      if (current) {
        if (current === pushedNoteId) pushedNoteId = id;
        void navigate({ to: '.', search: (prev) => ({ ...prev, note: id }), ...IN_PLACE });
        return;
      }
      pushedNoteId = id;
      void navigate({ to: '.', search: (prev) => ({ ...prev, note: id }), resetScroll: false });
    },
    [navigate],
  );

  const close = useCallback(() => {
    const current = new URLSearchParams(window.location.search).get('note');
    // Going back (rather than pushing a note-less URL) keeps history free of editor
    // entries, so the back gesture never reopens a note that was just closed.
    if (current && current === pushedNoteId) {
      pushedNoteId = null;
      router.history.back();
    } else {
      void navigate({ to: '.', search: (prev) => ({ ...prev, note: undefined }), ...IN_PLACE });
    }
  }, [navigate, router]);

  return { open, close };
}
