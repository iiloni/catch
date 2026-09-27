import { type ComponentProps, lazy, Suspense } from 'react';

const load = () => import('./NoteEditor');
const NoteEditor = lazy(() => load().then((module) => ({ default: module.NoteEditor })));

/** Starts downloading the editor so it is ready by the time a note opens. */
export function preloadNoteEditor() {
  void load();
}

/** BlockNote is the largest dependency, so it loads on demand instead of with the app shell. */
export function LazyNoteEditor(props: ComponentProps<typeof NoteEditor>) {
  return (
    <Suspense fallback={<div className="min-h-24" />}>
      <NoteEditor {...props} />
    </Suspense>
  );
}
