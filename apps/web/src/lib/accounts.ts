import { deleteAttachmentFiles } from './attachmentFiles';
import {
  type Account,
  activateAccount,
  authClient,
  clearAuthToken,
  deviceLeftPageAccount,
  forgetAccount,
  getAccounts,
  getSignedInUser,
} from './auth';
import { clearLocalData } from './collections';
import { editorNote, quickNote } from './dockState';
import { forgetImport } from './imports';
import { linkCaptureOpen } from './linkCapture';
import { countQueuedWrites, deleteLocalDatabase, deleteOutbox } from './localStore';
import { nativeReminders } from './nativeReminders';
import { dropPushSubscription, leavePush, syncPush } from './push';
import { getServerUrl } from './serverUrl';
import { clearIncomingShares } from './shareInbox';
import { getSyncStatus } from './syncStatus';
import { isUpdateReloadBlocked } from './useUpdateReloadBlocked';

/**
 * Several accounts can be signed in on one device (ADR 0019). One is in use at a time: its
 * notes are the ones open and its outbox the one sending. The others keep their session and
 * their copy of their notes until they are switched to, and their reminders still ring.
 */

const SWITCHED_KEY = 'catch-account-switched';

/**
 * Changes the account in use, opening one of its notes if asked. A full load, so the
 * collections open that account's notes.
 */
export function switchAccount(userId: string, noteId?: string) {
  if (userId === getSignedInUser()?.id || !activateAccount(userId)) return;
  sessionStorage.setItem(SWITCHED_KEY, 'true');
  window.location.assign(noteId ? `/?note=${encodeURIComponent(noteId)}` : '/');
}

/**
 * Follows a switch or sign-out made in another tab. This page holds the old account's notes
 * and outbox, so it loads again for whichever account the device now uses, once it holds no
 * open note or composer whose text the load would drop. Until then it stays on its account.
 */
export function followAccountChanges() {
  let waiting: (() => void)[] = [];
  const follow = () => {
    if (!deviceLeftPageAccount()) return;
    if (isUpdateReloadBlocked()) {
      if (waiting.length === 0) {
        waiting = [editorNote, quickNote, linkCaptureOpen].map((store) => store.subscribe(follow));
      }
      return;
    }
    // Not a reload: the address may name a note that the other account does not have.
    window.location.assign('/');
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
  return account.user.id === getSignedInUser()?.id
    ? getSyncStatus().pending
    : countQueuedWrites(account.user.id).catch(() => 0);
}

/** Signs an account out of this device and deletes its data here. */
export async function signOutAccount(account: Account) {
  if (account.user.id === getSignedInUser()?.id) return signOutCurrentAccount();
  // While the session still stands, the device stops ringing for this account.
  await leavePush(account).catch(() => undefined);
  await nativeReminders.clear(account.user.id).catch(() => undefined);
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await fetch(`${getServerUrl()}/api/auth/sign-out`, {
    method: 'POST',
    // The browser's own cookie is another account's session.
    credentials: 'omit',
    headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  const { id } = account.user;
  const removed = await Promise.allSettled([
    deleteLocalDatabase(id),
    deleteAttachmentFiles(id),
    clearIncomingShares(id),
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
  const account = getAccounts().find((other) => other.user.id === user?.id);
  // While the session still stands: the server must stop sending this browser the user's
  // reminders. The accounts that stay signed in go on ringing.
  if (account) await leavePush(account).catch(() => undefined);
  else await dropPushSubscription().catch(() => undefined);
  // The phone keeps reminders and a token of its own to ring with the app closed.
  await nativeReminders.clear(user?.id).catch(() => undefined);
  // Offline the server keeps the session until it expires; the device forgets it either way.
  await authClient.signOut().catch(() => undefined);
  await clearLocalData();
  forgetImport();
  clearAuthToken();
  const next = getAccounts()[0];
  if (next) activateAccount(next.user.id);
  // A full reload drops this user's synced notes from memory.
  window.location.assign(next ? '/' : '/login');
}
