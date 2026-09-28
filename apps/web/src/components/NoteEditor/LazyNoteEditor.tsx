import { type ComponentProps, lazy, memo, type ReactNode, Suspense } from 'react';

const load = () => import('./NoteEditor');
// Memoized: resizing the note pane re-renders the editor's surface on every pointer move.
const NoteEditor = memo(lazy(() => load().then((module) => ({ default: module.NoteEditor }))));

/** Starts downloading the editor so it is ready by the time a note opens. */
export function preloadNoteEditor() {
  void load();
}

/** BlockNote is the largest dependency, so it loads on demand instead of with the app shell. */
export function LazyNoteEditor({
  fallback = <div className="min-h-24" />,
  ...props
}: ComponentProps<typeof NoteEditor> & { fallback?: ReactNode }) {
  return (
    <Suspense fallback={fallback}>
      <NoteEditor {...props} />
    </Suspense>
  );
}
