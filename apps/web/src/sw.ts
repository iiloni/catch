/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { captureWebShare } from './lib/shareInbox';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();
cleanupOutdatedCaches();
const precached = self.__WB_MANIFEST;
// Release channels have icons of their own; the precache list names this build's.
const appIcon = precached
  .map((entry) => (typeof entry === 'string' ? entry : entry.url))
  .find((url) => url.endsWith('pwa-192x192.png'));
precacheAndRoute(precached);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }),
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/link-previews/assets/'),
  new CacheFirst({
    cacheName: 'link-preview-assets',
    plugins: [
      new ExpirationPlugin({ maxEntries: 1000 }),
      {
        cacheWillUpdate: async ({ response }) =>
          response.status === 0 || response.status === 200 ? response : null,
      },
    ],
  }),
);

registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname === '/share',
  async ({ request }) => {
    try {
      const id = await captureWebShare(await request.formData());
      return Response.redirect(new URL(`/share?id=${id}`, self.location.origin).href, 303);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Could not store the shared content on this device.';
      return Response.redirect(
        new URL(`/share?error=${encodeURIComponent(message)}`, self.location.origin).href,
        303,
      );
    }
  },
  'POST',
);

// Reminders arrive as Web Push messages from the Catch server (ADR 0018).
function pushMessage(event: PushEvent) {
  let data: unknown = null;
  try {
    data = event.data?.json();
  } catch {
    // Not ours, or not JSON. iOS withdraws push from an app that shows nothing for a message.
  }
  const field = (name: string) => {
    const value =
      data && typeof data === 'object' ? (data as Record<string, unknown>)[name] : undefined;
    return typeof value === 'string' ? value : null;
  };
  return { title: field('title') ?? 'Catch', body: field('body') ?? '', noteId: field('noteId') };
}

self.addEventListener('push', (event) => {
  const { title, body, noteId } = pushMessage(event);
  // `renotify` is in browsers but not yet in TypeScript's types.
  const options: NotificationOptions & { renotify: boolean } = {
    body,
    icon: appIcon,
    // A reminder that rings again replaces its last notification instead of stacking.
    tag: noteId ?? 'catch',
    // And alerts again when it does, which a replaced notification otherwise would not.
    renotify: true,
    data: { noteId },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const noteId: unknown = event.notification.data?.noteId;
  const path = typeof noteId === 'string' ? `/?note=${encodeURIComponent(noteId)}` : '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Only the signed-in app listens for the message; a window at sign-in or setup does not.
      const outside = (client: WindowClient) =>
        /^\/(login|setup|share|capture)\b/.test(new URL(client.url).pathname);
      const open = windows.find((client) => !outside(client)) ?? windows[0];
      if (!open) {
        await self.clients.openWindow(path);
        return;
      }
      await open.focus();
      if (outside(open)) {
        await open.navigate(path).catch(() => self.clients.openWindow(path));
        return;
      }
      // Navigating would reload the app; it opens the note itself.
      if (typeof noteId === 'string') open.postMessage({ type: 'OPEN_NOTE', noteId });
    })(),
  );
});
