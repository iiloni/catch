import type { WidgetLaunch } from '@catch/shared';
import { toast } from 'sonner';
import { switchAccount } from './accounts';
import { getAccounts, getSignedInUser } from './auth';
import { editorNote, quickNote, quickNoteColumn } from './dockState';
import { linkCaptureOpen } from './linkCapture';
import { nativeWidgets } from './nativeWidgets';
import { getServerUrl } from './serverUrl';
import { isUpdateReloadBlocked } from './useUpdateReloadBlocked';
import { leaveVault } from './vault';

/** Retained natively across the full reload needed to switch accounts. */
export function watchWidgetLaunch(navigate: (launch: WidgetLaunch) => Promise<void>) {
  let pending: WidgetLaunch | undefined;
  let running = false;
  let stopped = false;
  let announced = '';
  const consumed = new Set<string>();
  const tryOpen = async () => {
    const launch = pending;
    if (stopped || running || !launch || consumed.has(launch.id)) return;
    if (
      launch.server !== getServerUrl() ||
      !getAccounts().some(({ user }) => user.id === launch.account)
    ) {
      consumed.add(launch.id);
      await nativeWidgets.acknowledge(launch.id);
      toast('This widget’s account is no longer signed in. Configure the widget again.');
      return;
    }
    if (isUpdateReloadBlocked()) {
      if (announced !== launch.id) {
        announced = launch.id;
        toast('Close the open note to use this widget.');
      }
      return;
    }
    running = true;
    try {
      if (launch.account !== getSignedInUser()?.id) {
        consumed.add(launch.id);
        switchAccount(launch.account);
        return;
      }
      leaveVault();
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
      if (pending && pending.id !== launch.id) queueMicrotask(ask);
    }
  };
  const ask = () => {
    void tryOpen().catch((error: unknown) => console.error('Widget could not be opened', error));
  };
  const stop = nativeWidgets.watchLaunch((launch) => {
    pending = launch;
    ask();
  });
  const stops = [editorNote, quickNote, linkCaptureOpen].map((store) => store.subscribe(ask));
  return () => {
    stopped = true;
    stop();
    for (const stop of stops) stop();
  };
}
