import { Capacitor } from '@capacitor/core';

const SERVER_URL_KEY = 'catch-server-url';

/**
 * The web app is served by the Catch server, so it uses its own origin. The
 * Android app has no server of its own: the user enters their instance URL.
 */
export function getServerUrl(): string {
  if (!Capacitor.isNativePlatform()) return window.location.origin;
  return localStorage.getItem(SERVER_URL_KEY) ?? '';
}

export function setServerUrl(url: string) {
  localStorage.setItem(SERVER_URL_KEY, new URL(url).origin);
}

export function needsServerUrl(): boolean {
  return Capacitor.isNativePlatform() && !localStorage.getItem(SERVER_URL_KEY);
}
