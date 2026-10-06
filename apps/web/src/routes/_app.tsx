import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AnimatePresence } from 'motion/react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { AppUpdatePrompt } from '@/components/AppUpdatePrompt/AppUpdatePrompt';
import { Dock } from '@/components/Dock/Dock';
import { LinkCapture } from '@/components/LinkCapture/LinkCapture';
import { LinkPreviewOverlay } from '@/components/LinkPreviewOverlay/LinkPreviewOverlay';
import { preloadNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { NoteEditorOverlay } from '@/components/NoteEditorOverlay/NoteEditorOverlay';
import { PageBottomBlur } from '@/components/PageBottomBlur/PageBottomBlur';
import { QuickNote } from '@/components/QuickNote/QuickNote';
import { SplitHandle } from '@/components/SplitHandle/SplitHandle';
import { WebUpdatePrompt } from '@/components/WebUpdatePrompt/WebUpdatePrompt';
import { arrivedBySwitching, followAccountChanges, openAccountNote } from '@/lib/accounts';
import { getAuthToken, getSignedInUser } from '@/lib/auth';
import { quickNote } from '@/lib/dockState';
import { linkCaptureControls } from '@/lib/linkCapture';
import { watchNativeReminders } from '@/lib/nativeReminders';
import { useOpenNote } from '@/lib/openNote';
import { onNotificationOpen, syncPush } from '@/lib/push';
import { syncReminderSettings } from '@/lib/reminders';
import { needsServerUrl } from '@/lib/serverUrl';
import { useNotePaneLayout } from '@/lib/splitView';
import { watchUpdates } from '@/lib/updates';

/**
 * Signed-in layout: the page, the dock, the quick-note window, and the editor for `?note=<id>`.
 * On wide screens the editor is a pane beside the page rather than covering it.
 */
export const Route = createFileRoute('/_app')({
  validateSearch: z.object({ note: z.string().optional() }),
  beforeLoad: ({ location }) => {
    const search = { redirect: location.href };
    if (needsServerUrl()) throw redirect({ to: '/setup', search });
    if (!getAuthToken()) throw redirect({ to: '/login', search });
  },
  // Fetch the editor in the background once the page is up, without blocking it.
  onEnter: () => setTimeout(preloadNoteEditor, 1000),
  component: AppLayout,
});

function AppLayout() {
  useEffect(watchUpdates, []);
  const { open } = useOpenNote();
  useEffect(
    () =>
      onNotificationOpen((noteId, userId) => {
        // A reminder rings for every account on the device; this one may be another's.
        if (!userId || userId === getSignedInUser()?.id) open(noteId);
        else openAccountNote(userId, noteId);
      }),
    [open],
  );
  useEffect(watchNativeReminders, []);
  useEffect(followAccountChanges, []);
  useEffect(() => {
    // The page looks much the same for every account, so a switch says whose it is now.
    const user = getSignedInUser();
    if (user && arrivedBySwitching()) toast(`Switched to ${user.name || user.email}`);
  }, []);
  useEffect(() => {
    void syncPush();
    const user = getSignedInUser();
    if (!user) return;
    // A phone that has travelled reports its new zone when the app comes back into view,
    // and picks up quick times changed on another device.
    const report = () => {
      if (document.visibilityState === 'visible') void syncReminderSettings(user.id);
    };
    report();
    document.addEventListener('visibilitychange', report);
    // Android does not always tell the page it is visible again when the app resumes.
    const resumed = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void syncReminderSettings(user.id);
        })
      : null;
    return () => {
      document.removeEventListener('visibilitychange', report);
      void resumed?.then((listener) => listener.remove());
    };
  }, []);
  const { note } = Route.useSearch();
  const pane = useNotePaneLayout();
  const noteState = quickNote.use();
  const capture = linkCaptureControls.use();

  return (
    <>
      {/* No transform or filter here: either would break the pages' fixed headers. */}
      {/* Inert under an open note: the editor is not a modal dialog (the dock stays usable). */}
      {/*
        Padded for the pane rather than given a margin, so it spans the screen and clips there:
        a card still moving to a narrower page reaches under the pane, and anything wider than
        the screen would widen the layout viewport on Android, and the fixed headers with it.
      */}
      <div
        className="min-h-dvh overflow-x-clip pb-[var(--dock-space)]"
        style={{ paddingRight: pane.shown ? pane.noteWidth : 0 }}
        inert={
          (Boolean(note) && !pane.split) ||
          noteState === 'open' ||
          noteState === 'capture' ||
          Boolean(capture)
        }
      >
        <Outlet />
      </div>
      <QuickNote />
      <LinkCapture />
      <PageBottomBlur />
      <Dock />
      <NoteEditorOverlay noteId={note} />
      <LinkPreviewOverlay />
      <AppUpdatePrompt />
      <WebUpdatePrompt />
      <AnimatePresence>
        {pane.shown && note && (
          <SplitHandle listWidth={pane.listWidth} viewportWidth={pane.viewport.width} />
        )}
      </AnimatePresence>
    </>
  );
}
