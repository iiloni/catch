import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { editorControls, editorNote } from './dockState';

type Inserter = ReturnType<EditorControls['attachmentInserter']>;

/** Capture before a system picker takes focus, even while the editor is still loading. */
export function captureAttachmentInsertion(noteId: string): Promise<Inserter | null> {
  if (editorNote.get()?.id !== noteId) return Promise.resolve(null);
  const controls = editorControls.get();
  if (controls) return Promise.resolve(controls.attachmentInserter());

  return new Promise((resolve) => {
    const stop = () => {
      offControls();
      offNote();
    };
    const offControls = editorControls.subscribe(() => {
      const next = editorControls.get();
      if (!next) return;
      stop();
      resolve(editorNote.get()?.id === noteId ? next.attachmentInserter() : null);
    });
    const offNote = editorNote.subscribe(() => {
      if (editorNote.get()?.id === noteId) return;
      stop();
      resolve(null);
    });
  });
}
