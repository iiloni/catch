import { useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';
import { type Rect, setOrigin } from './noteTransition';

/** The note whose editor was opened by pushing a history entry in this session. */
let pushedNoteId: string | null = null;

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
      if (source) setOrigin(id, source);
      pushedNoteId = id;
      void navigate({ to: '.', search: (prev) => ({ ...prev, note: id }) });
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
      void navigate({ to: '.', search: (prev) => ({ ...prev, note: undefined }), replace: true });
    }
  }, [navigate, router]);

  return { open, close };
}
