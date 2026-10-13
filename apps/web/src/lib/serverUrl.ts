import { Capacitor } from '@capacitor/core';

const SERVER_URL_KEY = 'catch-server-url';
let pageServer: string | undefined;

/** Worktree builds stay pinned to their dev stack; installed bundles choose connections. */
export const supportsMultipleServers = () =>
  !import.meta.env.DEV && !import.meta.env.CATCH_DEV_SERVER_URL && Capacitor.isNativePlatform();

export function bindPageServer(url: string) {
  pageServer ??= url;
}

/**
 * The web app is served by the Catch server, so it uses its own origin. The
 * Android app has no server of its own: the user enters their instance URL.
 * In development (including Android live reload) the page comes from Vite,
 * which proxies `/api`, so its origin is always right.
 * Static Android dev builds bundle the page and pin API requests to the worktree URL.
 */
function usesOwnOrigin(): boolean {
  return !Capacitor.isNativePlatform() || import.meta.env.DEV;
}

export function getServerUrl(): string {
  if (supportsMultipleServers() && pageServer !== undefined) return pageServer;
  if (Capacitor.isNativePlatform() && import.meta.env.CATCH_DEV_SERVER_URL) {
    return import.meta.env.CATCH_DEV_SERVER_URL;
  }
  if (usesOwnOrigin()) return window.location.origin;
  return localStorage.getItem(SERVER_URL_KEY) ?? '';
}

export function setServerUrl(url: string) {
  // Keep the legacy server bound to adopted bare-user-ID stores. A downgraded APK must
  // never automatically connect those stores to the last newly added server.
  if (supportsMultipleServers() && localStorage.getItem(SERVER_URL_KEY)) return;
  localStorage.setItem(SERVER_URL_KEY, new URL(url).origin);
}

export function needsServerUrl(): boolean {
  return !getServerUrl();
}
