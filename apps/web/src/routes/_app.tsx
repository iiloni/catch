import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { Dock } from '@/components/Dock/Dock';
import { preloadNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteEditorOverlay } from '@/components/NoteEditorOverlay/NoteEditorOverlay';
import { QuickNote } from '@/components/QuickNote/QuickNote';
import { getAuthToken } from '@/lib/auth';
import { needsServerUrl } from '@/lib/serverUrl';

/** Signed-in layout: the page, the dock, the quick-note window, and the editor for `?note=<id>`. */
export const Route = createFileRoute('/_app')({
  validateSearch: z.object({ note: z.string().optional() }),
  beforeLoad: () => {
    if (needsServerUrl()) throw redirect({ to: '/setup' });
    if (!getAuthToken()) throw redirect({ to: '/login' });
  },
  // Fetch the editor in the background once the page is up, without blocking it.
  onEnter: () => setTimeout(preloadNoteEditor, 1000),
  component: AppLayout,
});

function AppLayout() {
  const { note } = Route.useSearch();

  return (
    <>
      {/* No transform or filter here: either would break the pages' fixed headers. */}
      {/* Inert under an open note: the editor is not a modal dialog (the dock stays usable). */}
      <div className="min-h-dvh pb-[var(--dock-space)]" inert={Boolean(note)}>
        <Outlet />
      </div>
      <QuickNote />
      <Dock />
      <NoteEditorOverlay noteId={note} />
    </>
  );
}
