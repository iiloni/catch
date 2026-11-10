import type { WidgetLaunch } from '@catch/shared';
import { toast } from 'sonner';
import { switchAccount } from './accounts';
import { accountId, accountServer, getAccountId, getAccounts, pagePath } from './auth';
import { waitForPendingWritesStored } from './collections';
import {
  editorNote,
  quickNote,
  quickNoteColumn,
  quickNoteFocusRequest,
  quickNoteMounted,
} from './dockState';
import { linkCaptureControls, linkCaptureOpen } from './linkCapture';
import { nativeWidgets } from './nativeWidgets';
import { leaveVault } from './vault';
import { beforeWidgetOpen, widgetNoteOpening } from './widgetNavigation';

function validAccount(launch: WidgetLaunch) {
  return getAccounts().some(
    (account) => accountId(account) === launch.account && accountServer(account) === launch.server,
  );
}

/** Resolve cold taps before the first browsing page can paint. Acknowledgement stays in the watcher. */
export async function prepareInitialWidgetLaunch() {
  try {
    const launch = await nativeWidgets.pending();
    if (!launch || !validAccount(launch)) return false;
    if (launch.account !== getAccountId()) {
      return await switchAccount(
        launch.account,
        launch.action === 'note' ? launch.noteId : undefined,
      );
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
  let closingNote = false;
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
      const changingAccount = launch.account !== getAccountId();
      if (!editorNote.get()) closingNote = false;
      if (editorNote.get() && (closingNote || changingAccount || launch.action !== 'note')) {
        // Back is asynchronous. A second close could replace its entry, then let the
        // delayed traversal pull the widget destination back to the browsing page.
        if (!closingNote) {
          closingNote = true;
          closeNote();
        }
        return;
      }
      if (changingAccount) {
        await waitForPendingWritesStored();
        if (stopped || pending?.id !== launch.id) return;
        if (
          await switchAccount(launch.account, launch.action === 'note' ? launch.noteId : undefined)
        )
          consumed.add(launch.id);
        return;
      }
      leaveVault();
      widgetNoteOpening.set(launch.action === 'note' ? (launch.noteId ?? null) : null);
      await navigate(launch);
      if (stopped) return;
      if (launch.action === 'compose') {
        quickNoteColumn.set(launch.column ?? null);
        quickNoteFocusRequest.set(quickNoteFocusRequest.get() + 1);
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
