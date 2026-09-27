import { type ComponentProps, lazy, type ReactNode, Suspense } from 'react';

const load = () => import('./NoteEditor');
const NoteEditor = lazy(() => load().then((module) => ({ default: module.NoteEditor })));

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
