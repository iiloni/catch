import type { Note } from '@catch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateNote } from './notes';
import { isVaultNote, updateVaultNote } from './vault';

export type SaveState = 'saved' | 'saving' | 'error';

const SAVE_DELAY_MS = 500;

/**
 * Debounced content saving for the open note. `flush` saves immediately and
 * runs automatically on unmount so closing the editor never drops edits.
 */
export function useNoteAutosave(noteId: string) {
  const [state, setState] = useState<SaveState>('saved');
  const pending = useRef<Note['content'] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const generation = useRef(0);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const content = pending.current;
    if (!content) return;
    pending.current = null;
    const current = ++generation.current;
    // A vault note is sealed before it is queued (ADR 0020).
    const saved = isVaultNote(noteId)
      ? updateVaultNote(noteId, { content }).then((write) => write.isPersisted.promise)
      : updateNote(noteId, { content }).isPersisted.promise;
    saved.then(
      () => {
        if (current === generation.current && !pending.current) setState('saved');
      },
      () => {
        if (current === generation.current) setState('error');
      },
    );
  }, [noteId]);

  const save = useCallback(
    (content: Note['content']) => {
      pending.current = content;
      setState('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => flush, [flush]);

  return { state, save, flush };
}
