import { editorNote, quickNote } from './dockState';
import { linkCaptureOpen } from './linkCapture';

export function isUpdateReloadBlocked() {
  return Boolean(editorNote.get()) || quickNote.get() !== 'closed' || linkCaptureOpen.get();
}

/** Composers and the editor flush on close; do not replace a page holding a draft. */
export function useUpdateReloadBlocked() {
  const note = editorNote.use();
  const composer = quickNote.use();
  const capture = linkCaptureOpen.use();
  return Boolean(note) || composer !== 'closed' || capture;
}
