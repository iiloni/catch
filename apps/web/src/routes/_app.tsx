import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { AppHeader } from '@/components/AppHeader/AppHeader';
import { preloadNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteEditorDialog } from '@/components/NoteEditorDialog/NoteEditorDialog';
import { getAuthToken } from '@/lib/auth';
import { needsServerUrl } from '@/lib/serverUrl';

/** Signed-in layout: header, page, and the note editor for `?note=<id>`. */
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
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6">
        <Outlet />
      </main>
      <NoteEditorDialog noteId={note} />
    </div>
  );
}
