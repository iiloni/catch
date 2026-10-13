import { toast } from 'sonner';
import { deleteAttachmentFiles } from './attachmentFiles';
import {
  type Account,
  accountId,
  accountPath,
  accountServer,
  activateAccount,
  authClient,
  clearAuthToken,
  forgetAccount,
  getAccountId,
  getAccounts,
  getSignedInUser,
  pageAccountGone,
  SWITCHED_KEY,
} from './auth';
import { clearLocalData, waitForPendingWritesStored } from './collections';
import { editorNote, quickNote, quickNoteMounted } from './dockState';
import { deleteHistoryStorage } from './historyStorage';
import { forgetImport } from './imports';
import { linkCaptureOpen } from './linkCapture';
import { countQueuedWrites, deleteLocalDatabase, deleteOutbox } from './localStore';
import { prepareNativeLogin } from './nativeAccounts';
import { nativeReminders } from './nativeReminders';
import { nativeWidgets } from './nativeWidgets';
import { dropPushSubscription, leavePush, syncPush } from './push';
import { getServerUrl, supportsMultipleServers } from './serverUrl';
import { clearIncomingShares } from './shareInbox';
import { getSyncStatus } from './syncStatus';
import { isUpdateReloadBlocked } from './useUpdateReloadBlocked';
import { forgetVault } from './vaultKeyStore';

/**
 * Several accounts can be signed in on one device (ADR 0019). A tab shows one of them: its
 * notes are the ones open and its outbox the one sending, and tabs can show different
 * accounts side by side. An account open in no tab keeps its session and its copy of its
 * notes until it is switched to. Every account's reminders ring.
 */

// Left for a tab that still has a signed-out account's database open, where the tab that
// signed it out could not delete it: that tab deletes it on its way out. Not set by "sign in
// again", which keeps the device's notes for the session that follows.
const removedKey = (userId: string) => `catch-account-removed:${userId}`;
{
  const user = getSignedInUser();
  if (user) localStorage.removeItem(removedKey(getAccountId() ?? user.id));
}

/**
 * Changes the account this tab shows, opening one of its notes if asked. A full load, so
 * the collections open that account's notes.
 */
export async function switchAccount(userId: string, noteId?: string) {
  if (userId === getAccountId()) return false;
  return openAccountPage(userId, noteId ? `/?note=${encodeURIComponent(noteId)}` : '/');
}

/** A full account load must not overtake a local save or a newly opened editor. */
export async function openAccountPage(userId: string, path = '/') {
  if (!getAccounts().some((account) => accountId(account) === userId)) return false;
  try {
    await waitForPendingWritesStored();
  } catch {
    toast.error('Could not save your changes on this device. Try switching again.');
    return false;
  }
  if (isUpdateReloadBlocked()) {
    toast('Close the open note before changing accounts.');
    return false;
  }
  if (!activateAccount(userId)) return false;
  sessionStorage.setItem(SWITCHED_KEY, 'true');
  window.location.assign(accountPath(userId, path));
  return true;
}

const openStores = [editorNote, quickNote, quickNoteMounted, linkCaptureOpen];
// Who this page was loaded for, still known after the account has been signed out.
const pageUser = getAccountId();

/**
 * Opens a note from its reminder's notification, which rings for every account on the
 * device: the note may be another account's than the one this page shows. The switch waits
 * for an open note or composer to close, since the load would drop what it has not saved.
 */
export function openAccountNote(userId: string, noteId: string) {
  if (!getAccounts().some((account) => accountId(account) === userId)) {
    toast('That reminder is for an account that is no longer signed in here.');
    return;
  }
  if (!isUpdateReloadBlocked()) {
    void switchAccount(userId, noteId);
    return;
  }
  toast('Close the open note to see that reminder.');
  const stops = openStores.map((store) =>
    store.subscribe(() => {
      if (isUpdateReloadBlocked()) return;
      for (const stop of stops) stop();
      void switchAccount(userId, noteId);
    }),
  );
}

/**
 * While the session still stands, the server must stop sending this browser the account's
 * reminders. Not for long, though: a connection that never answers must not hold up leaving,
 * and then the browser drops its subscription instead, for the accounts that stay to make
 * again.
 */
async function stopRinging(account: Account) {
  const left = await Promise.race([
    leavePush(account).then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!left) await dropPushSubscription().catch(() => undefined);
}

/**
 * Leaves an account that was signed out in another tab. This page holds its notes and
 * outbox, so it loads again as another account, or at sign-in, once it holds no open note
 * or composer whose text the load would drop. A switch in another tab changes nothing here.
 */
export function followAccountChanges() {
  let waiting: (() => void)[] = [];
  let leaving = false;
  const follow = () => {
    if (leaving || !pageAccountGone()) return;
    if (isUpdateReloadBlocked()) {
      if (waiting.length === 0) waiting = openStores.map((store) => store.subscribe(follow));
      return;
    }
    leaving = true;
    const user = pageUser;
    // The tab that signed it out could not delete a database this one had open.
    const cleared =
      user && localStorage.getItem(removedKey(user)) === 'true'
        ? clearLocalData().catch(() => undefined)
        : Promise.resolve();
    // Not a reload: the address names this account, and maybe a note the next does not have.
    void cleared.then(() => window.location.assign('/'));
  };
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage) follow();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    for (const stop of waiting) stop();
  };
}

/** Whether this page load is the one a switch asked for. True once. */
export function arrivedBySwitching() {
  const switched = sessionStorage.getItem(SWITCHED_KEY) === 'true';
  sessionStorage.removeItem(SWITCHED_KEY);
  return switched;
}

/** How many of an account's changes on this device have not reached the server. */
export async function unsyncedChanges(account: Account) {
  return accountId(account) === getAccountId()
    ? getSyncStatus().pending
    : countQueuedWrites(accountId(account)).catch(() => 0);
}

async function clearAccountWidgets(userId?: string) {
  try {
    await nativeWidgets.clear(userId);
    return true;
  } catch (error) {
    console.error('Widget previews could not be cleared before sign-out', error);
    toast.error('Could not clear widget previews. Try signing out again.');
    return false;
  }
}

/** Signs an account out of this device and deletes its data here. */
export async function signOutAccount(account: Account) {
  if (accountId(account) === getAccountId()) return signOutCurrentAccount();
  if (!(await clearAccountWidgets(accountId(account)))) return;
  localStorage.setItem(removedKey(accountId(account)), 'true');
  await stopRinging(account);
  await nativeReminders.clear(accountId(account)).catch(() => undefined);
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await fetch(`${accountServer(account)}/api/auth/sign-out`, {
    method: 'POST',
    // The browser's own cookie is another account's session.
    credentials: 'omit',
    headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  const id = accountId(account);
  const removed = await Promise.allSettled([
    deleteLocalDatabase(id),
    deleteHistoryStorage(id),
    deleteAttachmentFiles(id),
    clearIncomingShares(id),
    forgetVault(id),
  ]);
  for (const result of removed) {
    if (result.status === 'rejected') {
      console.warn("Some of a signed-out account's data is still on this device.", result.reason);
    }
  }
  deleteOutbox(id);
  // What the device remembered for this user: a later sign-in starts as on a new device,
  // with notifications off until they are turned on.
  for (const key of [
    `catch-import-${id}`,
    `catch-push:${id}`,
    `catch-reminder-times:${id}`,
    `catch-reminder-times:${id}:unsent`,
    `catch-snooze:${id}`,
    `catch-snooze:${id}:unsent`,
    `catch-time-zone:${id}`,
  ]) {
    localStorage.removeItem(key);
  }
  forgetAccount(id);
  // The browser's subscription was dropped if the server could not be told; this makes
  // one again for the accounts that stay.
  void syncPush();
}

/** Signs out the account in use, then carries on as another if one is signed in. */
export async function signOutCurrentAccount() {
  const user = getSignedInUser();
  const account = getAccounts().find((other) => accountId(other) === getAccountId());
  if (!(await clearAccountWidgets(getAccountId() ?? undefined))) return;
  if (user) localStorage.setItem(removedKey(getAccountId() ?? user.id), 'true');
  // The accounts that stay signed in go on ringing.
  if (account) await stopRinging(account);
  else await dropPushSubscription().catch(() => undefined);
  // The phone keeps reminders and a token of its own to ring with the app closed.
  await nativeReminders.clear(getAccountId() ?? undefined).catch(() => undefined);
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await authClient.signOut().catch(() => undefined);
  await clearLocalData();
  forgetImport();
  if (supportsMultipleServers()) prepareNativeLogin(getServerUrl());
  clearAuthToken();
  const next = getAccounts()[0];
  if (next) activateAccount(accountId(next));
  // A full reload drops this user's synced notes from memory.
  window.location.assign(next ? accountPath(accountId(next)) : '/login');
}
