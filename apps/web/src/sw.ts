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
precacheAndRoute(self.__WB_MANIFEST);
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
