import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { SHARE_PATH, shareTokenSchema } from '@catch/shared';

/**
 * The Android app's own address scheme (ADR 0020). Android only hands an `https` link to an
 * app whose build names the link's host, and a Catch server's host is its owner's to choose,
 * so a web page passes its link to the app through this instead.
 */
export const APP_SCHEME = 'catchnotes';
const APP_HOST = 'open';
const LAUNCH_KEY = 'catch-launch-link';

/**
 * What a browser on Android follows to open a Catch link in the app. An `intent:` address,
 * because a browser does nothing rather than show an error when no app takes it.
 */
export function openInAppLink(link: string) {
  return `intent://${APP_HOST}?${new URLSearchParams({ link })}#Intent;scheme=${APP_SCHEME};end`;
}

/** Whether the page is in a browser on a phone that could have the Android app. */
export function canOfferApp() {
  return !Capacitor.isNativePlatform() && /Android/i.test(navigator.userAgent);
}

export type AppLink =
  | { kind: 'share'; token: string }
  /** A link to a server this app is not connected to, which it cannot read from. */
  | { kind: 'elsewhere'; host: string };

/** What an address the app was opened with asks for, or null when it is not one of ours. */
export function parseAppLink(address: string, serverUrl: string): AppLink | null {
  let link: URL;
  try {
    const url = new URL(address);
    if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
    link = new URL(url.searchParams.get('link') ?? '');
  } catch {
    return null;
  }
  if (link.protocol !== 'https:' && link.protocol !== 'http:') return null;
  const [, token, ...rest] = link.pathname.slice(SHARE_PATH.length).split('/');
  if (!link.pathname.startsWith(`${SHARE_PATH}/`) || rest.length) return null;
  if (!shareTokenSchema.safeParse(token).success || !token) return null;
  if (serverUrl && link.origin !== new URL(serverUrl).origin)
    return { kind: 'elsewhere', host: link.host };
  return { kind: 'share', token };
}

/**
 * Calls `open` with each address the Android app is opened with. The one that started the
 * app is given once: a full page load (signing in, changing account) asks for it again.
 */
export function watchAppLinks(open: (address: string) => void) {
  if (Capacitor.getPlatform() !== 'android') return () => {};
  let stopped = false;
  void App.getLaunchUrl().then((launch) => {
    if (stopped || !launch?.url || sessionStorage.getItem(LAUNCH_KEY) === launch.url) return;
    sessionStorage.setItem(LAUNCH_KEY, launch.url);
    open(launch.url);
  });
  const listener = App.addListener('appUrlOpen', ({ url }) => {
    if (!stopped) open(url);
  });
  return () => {
    stopped = true;
    void listener.then((handle) => handle.remove());
  };
}
