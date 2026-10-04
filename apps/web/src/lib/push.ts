import { Capacitor } from '@capacitor/core';
import { api } from './api';
import { getSignedInUser } from './auth';
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

const enabledKey = () => `catch-push:${getSignedInUser()?.id ?? ''}`;

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
  return subscription && localStorage.getItem(enabledKey()) === 'true' ? 'on' : 'off';
}

export async function refreshPushState() {
  state.set(await detect());
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

/** This device's subscription under the server's key, made if it has none, and saved there. */
async function subscribe(worker: ServiceWorkerRegistration) {
  const key = decodeKey((await api.pushKey()).publicKey);
  let subscription = await worker.pushManager.getSubscription();
  // A subscription made for another key (the server's was replaced) cannot be reused.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('The browser gave no push keys.');
  await api.savePushSubscription({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } });
  return subscription;
}

/**
 * One at a time: a launch's `syncPush` still giving the server the subscription must not
 * land after the `disablePush` that takes it away.
 */
let queue: Promise<unknown> = Promise.resolve();
function inTurn<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
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
    localStorage.setItem(enabledKey(), 'true');
    state.set('on');
  });
}

export function disablePush() {
  if (nativeReminders.available) return nativeReminders.disable().then(refreshPushState);
  localStorage.removeItem(enabledKey());
  return inTurn(async () => {
    const subscription = await (await registration())?.pushManager.getSubscription();
    if (subscription) {
      // The server forgets it first, while the endpoint still names it. Offline it cannot,
      // and learns from the push service instead: an unsubscribed endpoint answers "gone".
      const told = await api.deletePushSubscription(subscription.endpoint).then(
        () => true,
        () => false,
      );
      const dropped = await subscription.unsubscribe().catch(() => false);
      if (!told && !dropped) {
        // Neither end let go, so this browser would still be sent the user's reminders.
        await refreshPushState();
        throw new Error('Could not turn notifications off.');
      }
    }
    await refreshPushState();
  });
}

/**
 * For a sign-out that could not wait for `disablePush`: the browser drops its subscription
 * without the server's say, so the push service refuses whatever the server still sends.
 */
export async function dropPushSubscription() {
  const subscription = await (await registration())?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => {});
}

/**
 * Run at launch: a device with notifications on gives the server its subscription again.
 * Browsers replace subscriptions (iOS drops them now and then), and a restored server
 * backup may not hold this one.
 */
export function syncPush() {
  if (nativeReminders.available) return refreshPushState();
  return inTurn(async () => {
    try {
      const worker = await registration();
      if (
        worker &&
        supported() &&
        Notification.permission === 'granted' &&
        localStorage.getItem(enabledKey()) === 'true'
      ) {
        await subscribe(worker);
      } else if (worker && supported()) {
        // A subscription this user never turned on was left by whoever used the browser
        // before, whose session ended without a sign-out. Dropped, so their reminders stop
        // arriving here.
        await (await worker.pushManager.getSubscription())?.unsubscribe();
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

/** A notification that was tapped asks the open app to show its note. */
export function onNotificationOpen(open: (noteId: string) => void) {
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
      open(data.noteId);
    }
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
