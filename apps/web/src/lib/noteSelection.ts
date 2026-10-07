import type { Note } from '@catch/shared';
import { useCallback, useEffect, useState } from 'react';
import { useBackHandler } from './backButton';
import { isSharedNote } from './sharing';

/**
 * Which of a page's notes are selected. Notes that leave the page (archived on another
 * device, say) leave the selection. Back and Escape end selecting.
 */
export function useNoteSelection(notes: readonly Note[]) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const selectedNotes = notes.filter((note) => ids.has(note.id));
  if (selectedNotes.length !== ids.size) {
    setIds(new Set(selectedNotes.map((note) => note.id)));
  }
  const selecting = selectedNotes.length > 0;

  const select = useCallback((note: Note, selected: boolean) => {
    // The actions on a selection edit notes, and someone else's note is only read here.
    if (isSharedNote(note)) return;
    setIds((current) => {
      if (current.has(note.id) === selected) return current;
      const next = new Set(current);
      if (selected) next.add(note.id);
      else next.delete(note.id);
      return next;
    });
  }, []);
  const clear = useCallback(() => setIds(new Set()), []);

  useBackHandler(selecting, clear);
  useEffect(() => {
    if (!selecting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Menus and popovers handle (and prevent) the Escape that closes them.
      if (event.key === 'Escape' && !event.defaultPrevented) clear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selecting, clear]);

  return { ids, notes: selectedNotes, selecting, select, clear };
}
