import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AnimatePresence } from 'motion/react';
import { z } from 'zod';
import { Dock } from '@/components/Dock/Dock';
import { LinkPreviewOverlay } from '@/components/LinkPreviewOverlay/LinkPreviewOverlay';
import { preloadNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteEditorOverlay } from '@/components/NoteEditorOverlay/NoteEditorOverlay';
import { PageBottomBlur } from '@/components/PageBottomBlur/PageBottomBlur';
import { QuickNote } from '@/components/QuickNote/QuickNote';
import { SplitHandle } from '@/components/SplitHandle/SplitHandle';
import { getAuthToken } from '@/lib/auth';
import { needsServerUrl } from '@/lib/serverUrl';
import { useNotePaneLayout } from '@/lib/splitView';

/**
 * Signed-in layout: the page, the dock, the quick-note window, and the editor for `?note=<id>`.
 * On wide screens the editor is a pane beside the page rather than covering it.
 */
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
  const pane = useNotePaneLayout();

  return (
    <>
      {/* No transform or filter here: either would break the pages' fixed headers. */}
      {/* Inert under an open note: the editor is not a modal dialog (the dock stays usable). */}
      <div
        className="min-h-dvh pb-[var(--dock-space)]"
        style={{ marginRight: pane.shown ? pane.noteWidth : 0 }}
        inert={Boolean(note) && !pane.split}
      >
        <Outlet />
      </div>
      <QuickNote />
      <PageBottomBlur />
      <Dock />
      <NoteEditorOverlay noteId={note} />
      <LinkPreviewOverlay />
      <AnimatePresence>
        {pane.shown && note && (
          <SplitHandle listWidth={pane.listWidth} viewportWidth={pane.viewport.width} />
        )}
      </AnimatePresence>
    </>
  );
}
