import type { Note } from '@catch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { waitForWriteStored } from './collections';
import { finishHistorySession, freezeHistory } from './noteHistory';
import { getNote, updateNote } from './notes';
import { beforeVaultLock } from './vault';

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
  // Debouncing clears pending content before its write reaches the durable outbox.
  const storedWrite = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    // A save that failed on the device is reported to whoever asks next, once: kept, it
    // would refuse every later close of a note that has nothing new to save.
    const lastWrite = () => {
      const stored = storedWrite.current;
      stored.catch(() => {
        if (storedWrite.current === stored) storedWrite.current = Promise.resolve();
      });
      return stored;
    };
    const content = pending.current;
    if (!content) return lastWrite();
    pending.current = null;
    // Deleted elsewhere, or in a vault that has since locked: there is nothing to save to.
    if (!getNote(noteId)) return lastWrite();
    const current = ++generation.current;
    const transaction = updateNote(noteId, { content });
    transaction.isPersisted.promise.then(
      () => {
        if (current === generation.current && !pending.current) setState('saved');
      },
      () => {
        if (current === generation.current) setState('error');
      },
    );
    storedWrite.current = waitForWriteStored(transaction);
    return storedWrite.current;
  }, [noteId]);

  const save = useCallback(
    (content: Note['content']) => {
      pending.current = content;
      setState('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush().catch(() => {}), SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(
    () => () => {
      void flush()
        .then(() => finishHistorySession(noteId))
        .catch(() => {});
    },
    [flush, noteId],
  );
  // A vault note must be saved while its key is still here to seal it with.
  useEffect(() => {
    const finish = async () => {
      await flush();
      await freezeHistory(noteId);
    };
    beforeVaultLock.add(finish);
    return () => void beforeVaultLock.delete(finish);
  }, [flush, noteId]);

  useEffect(() => {
    const background = () => {
      if (document.visibilityState === 'hidden')
        void flush()
          .then(() => freezeHistory(noteId))
          .catch(() => {});
    };
    document.addEventListener('visibilitychange', background);
    return () => document.removeEventListener('visibilitychange', background);
  }, [flush, noteId]);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    pending.current = null;
    generation.current++;
    setState('saved');
  }, []);
  return { state, save, flush, cancel };
}
