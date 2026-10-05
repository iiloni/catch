import { Capacitor } from '@capacitor/core';
import { useEffect } from 'react';
import { z } from 'zod';
import { api } from './api';
import { type Account, getAccounts, getSignedInUser } from './auth';
import { nativeReminders } from './nativeReminders';
import { createStore } from './store';

/**
 * Notifications in a browser or an installed web app come by Web Push (ADR 0018): this
 * device subscribes with its push service and gives the server the subscription. The
 * Android app has no Web Push and rings reminders itself (`nativeReminders.ts`); the same
 * states and actions stand for both, so Settings need not know which it is on.
 *
 * - `needs-install`: iOS only allows push to a web app added to the Home Screen.
 * - `unsupported`: no push in this browser, or no service worker (the dev server has none).
 * - `blocked`: the user turned notifications down in the browser or for the app.
 */
export type PushState = 'needs-install' | 'unsupported' | 'blocked' | 'off' | 'on';

const state = createStore<PushState | null>(null);
export const usePushState = state.use;

const enabledKey = (userId: string) => `catch-push:${userId}`;
const isEnabled = (userId: string) => localStorage.getItem(enabledKey(userId)) === 'true';

/**
 * Notifications are turned on for the device, and it then rings for every account signed in
 * on it (ADR 0019): on for one of them is on for all, including one added later.
 */
const deviceWantsPush = () => getAccounts().some(({ user }) => isEnabled(user.id));

// Whose reminders the server may be sending to this browser's subscription: every account
// this device has registered on it and has not taken off again. One that is no longer signed
// in here left without saying so, and the subscription is replaced to be rid of it.
const OWNERS_KEY = 'catch-push-owners';
const ownersSchema = z.object({ endpoint: z.string(), users: z.array(z.string()) });

function owners(endpoint: string): string[] | null {
  try {
    const parsed = ownersSchema.safeParse(JSON.parse(localStorage.getItem(OWNERS_KEY) ?? ''));
    return parsed.success && parsed.data.endpoint === endpoint ? parsed.data.users : null;
  } catch {
    return null;
  }
}

function setOwners(endpoint: string, users: string[]) {
  localStorage.setItem(OWNERS_KEY, JSON.stringify({ endpoint, users: [...new Set(users)] }));
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isInstalled() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration().catch(() => undefined)) ?? null;
}

const supported = () => 'PushManager' in window && 'Notification' in window;

async function detect(): Promise<PushState> {
  if (nativeReminders.available) return nativeReminders.state();
  if (Capacitor.isNativePlatform()) return 'unsupported';
  if (isIos() && !isInstalled()) return 'needs-install';
  if (!supported()) return 'unsupported';
  const worker = await registration();
  if (!worker) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const subscription = await worker.pushManager.getSubscription().catch(() => null);
  return subscription && deviceWantsPush() ? 'on' : 'off';
}

export async function refreshPushState() {
  state.set(await detect());
}

/**
 * Whether the Android app is not allowed to show reminders. A browser may well be left
 * off, since another device can ring; a phone with the app is where they are expected.
 */
export function useAppNotificationsOff() {
  const current = state.use();
  useEffect(() => {
    if (nativeReminders.available) void refreshPushState();
  }, []);
  return nativeReminders.available && (current === 'off' || current === 'blocked');
}

const sameKey = (a: ArrayBuffer | null, b: Uint8Array) => {
  if (!a) return false;
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((byte, index) => byte === b[index]);
};

function decodeKey(key: string) {
  const base64 = key.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/**
 * This device's subscription under the server's key, made if it has none, and saved there
 * for every account signed in here. Throws if the account in use could not be saved.
 */
async function subscribe(worker: ServiceWorkerRegistration) {
  const accounts = getAccounts();
  const ids = accounts.map(({ user }) => user.id);
  const key = decodeKey((await api.pushKey()).publicKey);
  let subscription = await worker.pushManager.getSubscription();
  const known = subscription && owners(subscription.endpoint);
  // A subscription made for another key (the server's was replaced) cannot be reused. Nor
  // can one that may still ring for someone who is not signed in here any more, or whose
  // owners this device has no record of.
  if (
    subscription &&
    (!sameKey(subscription.options.applicationServerKey, key) ||
      !known ||
      known.some((id) => !ids.includes(id)))
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('The browser gave no push keys.');
  // Recorded before asking: a request can reach the server and still fail here.
  setOwners(endpoint, ids);
  const current = getSignedInUser()?.id;
  // The account in use goes last: a server from before accounts shared a browser gives the
  // subscription to whoever saved it last.
  const ordered = [...accounts].sort(
    (a, b) => Number(a.user.id === current) - Number(b.user.id === current),
  );
  for (const account of ordered) {
    // Signed out, perhaps in another tab, since the loop began: saving it now would leave
    // its reminders arriving here with nobody left to take them off.
    if (!getAccounts().some(({ user }) => user.id === account.user.id)) continue;
    try {
      await api.savePushSubscription(
        { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
        account.token,
      );
      localStorage.setItem(enabledKey(account.user.id), 'true');
    } catch (error) {
      // Another account's session may have ended; the next launch tries it again.
      if (account.user.id === current) throw error;
    }
  }
  return subscription;
}

/**
 * One at a time: a launch's `syncPush` still giving the server the subscription must not
 * land after the `disablePush` that takes it away. Across tabs too, where Web Locks allow:
 * one tab signing an account out must not cross another tab's launch saving it.
 */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const locked = (): Promise<T> =>
    navigator.locks ? navigator.locks.request('catch-push', task) : task();
  const run = queue.then(locked, locked);
  queue = run.catch(() => {});
  return run;
}

/** Asks for permission and subscribes. Call from a tap: browsers only ask then. */
export async function enablePush() {
  if (nativeReminders.available) {
    await nativeReminders.enable();
    return refreshPushState();
  }
  if (!supported()) throw new Error('This browser cannot receive notifications.');
  // Asked before anything is awaited: Safari only shows the prompt while the tap is live.
  const asked = Notification.requestPermission();
  return inTurn(async () => {
    const permission = await asked;
    const worker = await registration();
    if (!worker) throw new Error('This browser cannot receive notifications.');
    if (permission !== 'granted') {
      state.set(Notification.permission === 'denied' ? 'blocked' : 'off');
      return;
    }
    await subscribe(worker);
    state.set('on');
  });
}

const forgetEnabled = () => {
  for (const { user } of getAccounts()) localStorage.removeItem(enabledKey(user.id));
};

/** Turns notifications off for the device: every account signed in on it stops ringing here. */
export function disablePush() {
  if (nativeReminders.available) return nativeReminders.disable().then(refreshPushState);
  const accounts = getAccounts();
  forgetEnabled();
  return inTurn(async () => {
    const subscription = await (await registration())?.pushManager.getSubscription();
    if (subscription) {
      // The server forgets it first, while the endpoint still names it. Offline it cannot,
      // and learns from the push service instead: an unsubscribed endpoint answers "gone".
      const { endpoint } = subscription;
      const told = await Promise.allSettled(
        accounts.map(({ token }) => api.deletePushSubscription(endpoint, token)),
      );
      const dropped = await subscription.unsubscribe().catch(() => false);
      if (!dropped && told.some((result) => result.status === 'rejected')) {
        // Neither end let go, so this browser would still be sent someone's reminders.
        await refreshPushState();
        throw new Error('Could not turn notifications off.');
      }
      localStorage.removeItem(OWNERS_KEY);
    }
    await refreshPushState();
  });
}

/**
 * An account is signing out of this device: the server must stop sending this browser its
 * reminders, while the session still stands. Not for long, though: a connection that never
 * answers must not hold up leaving. The accounts that stay keep ringing.
 */
export function leavePush(account: Account) {
  if (nativeReminders.available) return Promise.resolve();
  const { id } = account.user;
  const wanted = deviceWantsPush();
  localStorage.removeItem(enabledKey(id));
  // Notifications are on for the device: the accounts that stay keep them on, even one the
  // server has not yet been able to save.
  if (wanted) {
    for (const { user } of getAccounts()) {
      if (user.id !== id) localStorage.setItem(enabledKey(user.id), 'true');
    }
  }
  return inTurn(async () => {
    const worker = await registration();
    // Its reminders already showing would open an account that is no longer here.
    const shown = (await worker?.getNotifications?.().catch(() => [])) ?? [];
    for (const notification of shown) {
      const data: unknown = notification.data;
      if (data && typeof data === 'object' && 'userId' in data && data.userId === id) {
        notification.close();
      }
    }
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) return;
    const told = await api
      .deletePushSubscription(subscription.endpoint, account.token, AbortSignal.timeout(5000))
      .then(
        () => true,
        () => false,
      );
    if (told) {
      const users = owners(subscription.endpoint);
      if (users) {
        setOwners(
          subscription.endpoint,
          users.filter((user) => user !== id),
        );
      }
      return;
    }
    // The server could not be told, so the browser drops the subscription itself and the
    // push service refuses whatever is still sent. The accounts that stay subscribe again
    // at the next launch.
    await subscription.unsubscribe().catch(() => {});
    localStorage.removeItem(OWNERS_KEY);
  });
}

/** For a sign-out that knows no account to leave: the browser stops taking anyone's pushes. */
export async function dropPushSubscription() {
  const subscription = await (await registration())?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => {});
  localStorage.removeItem(OWNERS_KEY);
}

/**
 * Run at launch: a device with notifications on gives the server its subscription again,
 * for every account signed in on it. Browsers replace subscriptions (iOS drops them now and
 * then), a restored server backup may not hold this one, and an account may have been added.
 */
export function syncPush() {
  if (nativeReminders.available) return refreshPushState();
  return inTurn(async () => {
    try {
      const worker = await registration();
      if (worker && supported() && Notification.permission === 'granted' && deviceWantsPush()) {
        await subscribe(worker);
      } else if (worker && supported()) {
        // A subscription nobody here turned on was left by whoever used the browser
        // before, whose session ended without a sign-out. Dropped, so their reminders stop
        // arriving here.
        await (await worker.pushManager.getSubscription())?.unsubscribe();
        localStorage.removeItem(OWNERS_KEY);
      }
    } catch {
      // Offline; the next launch tries again.
    }
    await refreshPushState();
  });
}

export async function sendTestPush() {
  if (nativeReminders.available) return nativeReminders.test();
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) throw new Error('Notifications are not on for this device.');
  const { sent } = await api.testPush(subscription.endpoint);
  if (sent === 0) throw new Error('The push service did not take the notification.');
}

/**
 * A notification that was tapped asks the open app to show its note. It says whose note it
 * is when it knows, since the app may be showing another account's.
 */
export function onNotificationOpen(open: (noteId: string, userId?: string) => void) {
  if (nativeReminders.available) return nativeReminders.onOpen(open);
  if (!('serviceWorker' in navigator)) return () => {};
  const listener = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      data &&
      typeof data === 'object' &&
      'type' in data &&
      data.type === 'OPEN_NOTE' &&
      'noteId' in data &&
      typeof data.noteId === 'string'
    ) {
      open(
        data.noteId,
        'userId' in data && typeof data.userId === 'string' ? data.userId : undefined,
      );
    }
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
