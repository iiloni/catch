import type { WidgetLaunch } from '@catch/shared';
import { toast } from 'sonner';
import { switchAccount } from './accounts';
import { getAccounts, getSignedInUser, pagePath } from './auth';
import { waitForPendingWritesStored } from './collections';
import { editorNote, quickNote, quickNoteColumn, quickNoteMounted } from './dockState';
import { linkCaptureControls, linkCaptureOpen } from './linkCapture';
import { nativeWidgets } from './nativeWidgets';
import { getServerUrl } from './serverUrl';
import { leaveVault } from './vault';
import { beforeWidgetOpen, widgetNoteOpening } from './widgetNavigation';

function validAccount(launch: WidgetLaunch) {
  return (
    launch.server === getServerUrl() && getAccounts().some(({ user }) => user.id === launch.account)
  );
}

/** Resolve cold taps before the first browsing page can paint. Acknowledgement stays in the watcher. */
export async function prepareInitialWidgetLaunch() {
  try {
    const launch = await nativeWidgets.pending();
    if (!launch || !validAccount(launch)) return false;
    if (launch.account !== getSignedInUser()?.id) {
      switchAccount(launch.account, launch.action === 'note' ? launch.noteId : undefined);
      return true;
    }
    if (launch.action === 'note' && launch.noteId) {
      widgetNoteOpening.set(launch.noteId);
      window.history.replaceState(
        window.history.state,
        '',
        pagePath(`/?note=${encodeURIComponent(launch.noteId)}`),
      );
    }
  } catch (error) {
    console.error('Initial widget launch could not be read', error);
  }
  return false;
}

/** Retained natively across the full reload needed to switch accounts. */
export function watchWidgetLaunch(
  navigate: (launch: WidgetLaunch) => Promise<void>,
  closeNote: () => void,
) {
  let pending: WidgetLaunch | undefined;
  let running = false;
  let retry = false;
  let stopped = false;
  let captureAttempt = '';
  const consumed = new Set<string>();
  const tryOpen = async () => {
    const launch = pending;
    if (stopped || !launch || consumed.has(launch.id)) return;
    if (running) {
      retry = true;
      return;
    }
    if (!validAccount(launch)) {
      consumed.add(launch.id);
      await nativeWidgets.acknowledge(launch.id);
      toast('This widget’s account is no longer signed in. Configure the widget again.');
      return;
    }
    const capture = linkCaptureControls.get();
    if (capture || linkCaptureOpen.get()) {
      if (capture && !capture.busy && captureAttempt !== launch.id) {
        captureAttempt = launch.id;
        if (capture.canSave) capture.save();
        else toast('Finish or cancel the link capture before opening this widget.');
      }
      return;
    }
    if (quickNote.get() !== 'closed') {
      quickNote.set('closed');
      return;
    }
    if (quickNoteMounted.get()) return;
    running = true;
    try {
      await Promise.all([...beforeWidgetOpen].map((flush) => flush()));
      if (stopped || pending?.id !== launch.id) return;
      const changingAccount = launch.account !== getSignedInUser()?.id;
      if (editorNote.get() && (changingAccount || launch.action !== 'note')) {
        closeNote();
        return;
      }
      if (changingAccount) {
        await waitForPendingWritesStored();
        if (stopped || pending?.id !== launch.id) return;
        consumed.add(launch.id);
        switchAccount(launch.account, launch.action === 'note' ? launch.noteId : undefined);
        return;
      }
      leaveVault();
      widgetNoteOpening.set(launch.action === 'note' ? (launch.noteId ?? null) : null);
      await navigate(launch);
      if (stopped) return;
      if (launch.action === 'compose') {
        quickNoteColumn.set(launch.column ?? null);
        quickNote.set('open');
      }
      consumed.add(launch.id);
      await nativeWidgets.acknowledge(launch.id);
    } finally {
      running = false;
      if (retry || (pending && pending.id !== launch.id)) {
        retry = false;
        ask();
      }
    }
  };
  const ask = () => {
    queueMicrotask(() => {
      void tryOpen().catch((error: unknown) => {
        console.error('Widget could not be opened', error);
        toast('Could not switch to the widget. Your edits are still here. Try again.');
      });
    });
  };
  const stop = nativeWidgets.watchLaunch((launch) => {
    pending = launch;
    ask();
  });
  const stops = [editorNote, quickNote, quickNoteMounted, linkCaptureOpen, linkCaptureControls].map(
    (store) => store.subscribe(ask),
  );
  return () => {
    stopped = true;
    stop();
    for (const stop of stops) stop();
  };
}
