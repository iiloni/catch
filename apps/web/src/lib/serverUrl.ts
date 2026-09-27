import { Capacitor } from '@capacitor/core';

const SERVER_URL_KEY = 'catch-server-url';

/**
 * The web app is served by the Catch server, so it uses its own origin. The
 * Android app has no server of its own: the user enters their instance URL.
 * In development (including Android live reload) the page comes from Vite,
 * which proxies `/api`, so its origin is always right.
 */
function usesOwnOrigin(): boolean {
  return !Capacitor.isNativePlatform() || import.meta.env.DEV;
}

export function getServerUrl(): string {
  if (usesOwnOrigin()) return window.location.origin;
  return localStorage.getItem(SERVER_URL_KEY) ?? '';
}

export function setServerUrl(url: string) {
  localStorage.setItem(SERVER_URL_KEY, new URL(url).origin);
}

export function needsServerUrl(): boolean {
  return !usesOwnOrigin() && !localStorage.getItem(SERVER_URL_KEY);
}
