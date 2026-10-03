import { Capacitor } from '@capacitor/core';
import { webBuildSchema } from '@catch/shared';
import { createStore } from './store';
import { isUpdateReloadBlocked } from './useUpdateReloadBlocked';

const updates = createStore({
  target: null as string | null,
  reloading: false,
  error: null as string | null,
});
export const useWebUpdates = updates.use;

let registration: Promise<ServiceWorkerRegistration | null> | null = null;
let checking: Promise<void> | null = null;

function enabled() {
  return import.meta.env.CATCH_WEB_BUILD === 'true' && Capacitor.getPlatform() === 'web';
}

/** Register explicitly so native WebViews never cache their bundled app as a PWA. */
export function initializeWebUpdates() {
  if (!enabled() || registration || !('serviceWorker' in navigator)) return;
  registration = navigator.serviceWorker
    .register('/sw.js', { updateViaCache: 'none' })
    .catch(() => navigator.serviceWorker.getRegistration().then((existing) => existing ?? null))
    .catch(() => null);
}

async function latestBuild() {
  // JSON is not precached. A nonce also bypasses intermediary HTTP caches.
  const response = await fetch(`/build.json?check=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Could not check the web app update. Connect and try again.');
  const build = webBuildSchema.safeParse(await response.json().catch(() => null));
  if (!build.success) throw new Error('Could not read the web app version. Try again.');
  return build.data;
}

export function checkForWebUpdates() {
  if (!enabled()) return Promise.resolve();
  initializeWebUpdates();
  checking ??= (async () => {
    const [build] = await Promise.allSettled([
      latestBuild(),
      registration?.then((worker) => worker?.update()),
    ]);
    // Older servers have no build.json. Offline and unsupported metadata preserve the
    // last known update, without turning a failed check into an update notification.
    if (build.status === 'fulfilled') {
      updates.set({
        ...updates.get(),
        target: build.value.id === import.meta.env.CATCH_BUILD_ID ? null : build.value.id,
      });
    }
  })().finally(() => {
    checking = null;
  });
  return checking;
}

function waitForWorker(worker: ServiceWorker, ready: () => boolean) {
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      worker.removeEventListener('statechange', changed);
      navigator.serviceWorker.removeEventListener('controllerchange', changed);
      window.clearTimeout(timeout);
    };
    const changed = () => {
      if (ready()) {
        finish();
        resolve();
      } else if (worker.state === 'redundant') {
        finish();
        reject(new Error('The app update could not be prepared. Try again.'));
      }
    };
    const timeout = window.setTimeout(() => {
      finish();
      reject(new Error('The app update took too long. Try again.'));
    }, 20_000);
    worker.addEventListener('statechange', changed);
    navigator.serviceWorker.addEventListener('controllerchange', changed);
    changed();
  });
}

/** Update the cache before navigating; an ordinary reload can still serve the old shell. */
export async function reloadForWebUpdate() {
  if (!enabled() || updates.get().reloading) return;
  updates.set({ ...updates.get(), reloading: true, error: null });
  try {
    if (isUpdateReloadBlocked()) throw new Error('Close the open note or draft before reloading.');
    // Do not leave the page when connectivity was lost after the prompt appeared.
    await latestBuild();
    const { waitForPendingWritesStored } = await import('./collections');
    await waitForPendingWritesStored();
    const worker = await registration;
    if (worker) {
      await worker.update();
      if (worker.installing) {
        const installing = worker.installing;
        await waitForWorker(installing, () =>
          ['installed', 'activated'].includes(installing.state),
        );
      }
      if (worker.waiting) {
        const waiting = worker.waiting;
        const activated = waitForWorker(
          waiting,
          () => waiting.state === 'activated' && navigator.serviceWorker.controller === waiting,
        );
        waiting.postMessage({ type: 'SKIP_WAITING' });
        await activated;
      }
    } else if (navigator.serviceWorker?.controller) {
      throw new Error('Could not prepare the cached app update. Try again.');
    }
    if (isUpdateReloadBlocked()) throw new Error('Close the open note or draft before reloading.');
    window.location.reload();
  } catch (error) {
    updates.set({
      ...updates.get(),
      reloading: false,
      error: error instanceof Error ? error.message : 'Could not reload the app. Try again.',
    });
  }
}
