import type { Note } from '@catch/shared';
import { useEffect } from 'react';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { editorControls, editorNote } from '@/lib/dockState';

/** Exiting surfaces overlap the next note, but only the present surface owns its toolbar. */
export function useEditorDock(note: Note, controls: EditorControls | null, isPresent: boolean) {
  useEffect(() => {
    if (isPresent) editorNote.set(note);
  }, [note, isPresent]);

  useEffect(() => {
    if (!isPresent) return;
    return () => {
      if (editorNote.get()?.id === note.id) editorNote.set(null);
    };
  }, [note.id, isPresent]);

  useEffect(() => {
    if (!isPresent) return;
    editorControls.set(controls);
    return () => {
      if (editorControls.get() === controls) editorControls.set(null);
    };
  }, [controls, isPresent]);
}
