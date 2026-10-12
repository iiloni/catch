import type { Note } from '@catch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { waitForWriteStored } from './collections';
import { finishHistorySession, freezeHistory } from './noteHistory';
import { getNote, updateNote } from './notes';
import { beforeVaultLock } from './vault';
import { beforeWidgetOpen } from './widgetNavigation';

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
  // The content of the latest write, and the content whose failed save a close was told of.
  const writing = useRef<Note['content'] | null>(null);
  const told = useRef<Note['content'] | null>(null);

  const attempt = useCallback(() => {
    window.clearTimeout(timer.current);
    const content = pending.current;
    if (!content) return storedWrite.current;
    pending.current = null;
    // Deleted elsewhere, or in a vault that has since locked: there is nothing to save to.
    if (!getNote(noteId)) return storedWrite.current;
    const current = ++generation.current;
    writing.current = content;
    const transaction = updateNote(noteId, { content });
    transaction.isPersisted.promise.then(
      () => {
        if (current === generation.current && !pending.current) setState('saved');
      },
      () => {
        if (current === generation.current) setState('error');
      },
    );
    const stored: Promise<void> = waitForWriteStored(transaction).catch((error: unknown) => {
      if (storedWrite.current === stored) storedWrite.current = Promise.resolve();
      // Kept, so the next save or close writes it again.
      if (current === generation.current && !pending.current) pending.current = content;
      throw error;
    });
    storedWrite.current = stored;
    return stored;
  }, [noteId]);
  const flush = useCallback(() => {
    const stored = attempt();
    const content = writing.current;
    // A close is refused once for content that could not be stored. Refused every time, a
    // device that cannot store would hold the note open for good.
    return stored.catch((error: unknown) => {
      if (told.current === content) return;
      told.current = content;
      throw error;
    });
  }, [attempt]);

  const save = useCallback(
    (content: Note['content']) => {
      pending.current = content;
      setState('saving');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void attempt().catch(() => {}), SAVE_DELAY_MS);
    },
    [attempt],
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
    // A widget may replace this note; its edits must reach durable storage first.
    beforeWidgetOpen.add(flush);
    return () => {
      beforeVaultLock.delete(finish);
      beforeWidgetOpen.delete(flush);
    };
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
