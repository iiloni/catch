import { Capacitor } from '@capacitor/core';
import { api } from './api';
import { getSignedInUser } from './auth';
import { createStore } from './store';

/**
 * Notifications in a browser or an installed web app come by Web Push (ADR 0016): this
 * device subscribes with its push service and gives the server the subscription.
 *
 * - `native`: the Android app, which will ring reminders itself and has no Web Push.
 * - `needs-install`: iOS only allows push to a web app added to the Home Screen.
 * - `unsupported`: no push in this browser, or no service worker (the dev server has none).
 * - `blocked`: the user turned notifications down in the browser.
 */
export type PushState = 'native' | 'needs-install' | 'unsupported' | 'blocked' | 'off' | 'on';

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
  if (Capacitor.isNativePlatform()) return 'native';
  if (!supported()) return isIos() && !isInstalled() ? 'needs-install' : 'unsupported';
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

/** Asks for permission and subscribes. Call from a tap: browsers only ask then. */
export async function enablePush() {
  const worker = await registration();
  if (!worker || !supported()) throw new Error('This browser cannot receive notifications.');
  if ((await Notification.requestPermission()) !== 'granted') {
    state.set(Notification.permission === 'denied' ? 'blocked' : 'off');
    return;
  }
  await subscribe(worker);
  localStorage.setItem(enabledKey(), 'true');
  state.set('on');
}

export async function disablePush() {
  localStorage.removeItem(enabledKey());
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (subscription) {
    // The server forgets it first, while the endpoint still names it.
    await api.deletePushSubscription(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe().catch(() => {});
  }
  await refreshPushState();
}

/**
 * Run at launch: a device with notifications on gives the server its subscription again.
 * Browsers replace subscriptions (iOS drops them now and then), and a restored server
 * backup may not hold this one.
 */
export async function syncPush() {
  try {
    const worker = await registration();
    if (
      worker &&
      supported() &&
      Notification.permission === 'granted' &&
      localStorage.getItem(enabledKey()) === 'true'
    ) {
      await subscribe(worker);
    }
  } catch {
    // Offline; the next launch tries again.
  }
  await refreshPushState();
}

export async function sendTestPush() {
  const subscription = await (await registration())?.pushManager.getSubscription();
  if (!subscription) throw new Error('Notifications are not on for this device.');
  const { sent } = await api.testPush(subscription.endpoint);
  if (sent === 0) throw new Error('The push service did not take the notification.');
}

/** A notification that was tapped asks the open app to show its note. */
export function onNotificationOpen(open: (noteId: string) => void) {
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
