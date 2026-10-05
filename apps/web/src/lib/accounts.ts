import { deleteAttachmentFiles } from './attachmentFiles';
import {
  type Account,
  activateAccount,
  authClient,
  clearAuthToken,
  forgetAccount,
  getAccounts,
  getSignedInUser,
} from './auth';
import { clearLocalData } from './collections';
import { forgetImport } from './imports';
import { countQueuedWrites, deleteLocalDatabase, deleteOutbox } from './localStore';
import { nativeReminders } from './nativeReminders';
import { disablePush, dropPushSubscription } from './push';
import { getServerUrl } from './serverUrl';
import { clearIncomingShares } from './shareInbox';
import { getSyncStatus } from './syncStatus';

/**
 * Several accounts can be signed in on one device (ADR 0019). One is in use at a time: its
 * notes are the ones open, its outbox the one sending, and its reminders the ones that ring.
 * The others keep their session and their copy of their notes until they are switched to.
 */

const SWITCHED_KEY = 'catch-account-switched';

/** Changes the account in use. A full load, so the collections open that account's notes. */
export function switchAccount(userId: string) {
  if (userId === getSignedInUser()?.id || !activateAccount(userId)) return;
  sessionStorage.setItem(SWITCHED_KEY, 'true');
  window.location.assign('/');
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
  await Promise.allSettled([
    deleteLocalDatabase(id),
    deleteAttachmentFiles(id),
    clearIncomingShares(id),
  ]);
  deleteOutbox(id);
  localStorage.removeItem(`catch-import-${id}`);
  forgetAccount(id);
}

/** Signs out the account in use, then carries on as another if one is signed in. */
export async function signOutCurrentAccount() {
  // While the session still stands: the server must stop sending this browser the user's
  // reminders. Not for long, though: a connection that never answers must not hold up leaving.
  const told = await Promise.race([
    disablePush().then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!told) await dropPushSubscription().catch(() => undefined);
  // The phone keeps reminders and a token of its own to ring with the app closed.
  await nativeReminders.clear().catch(() => undefined);
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
