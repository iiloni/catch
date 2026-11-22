import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect } from 'react';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** The page lets the launch screen leave itself (`useFinishLaunch`), once its notes are drawn. */
    holdsLaunchScreen?: boolean;
  }
}

// A local plugin in the Android project (LaunchScreenPlugin.java).
const LaunchScreen = registerPlugin<{ ready(): Promise<void> }>('LaunchScreen');

let launching = Capacitor.getPlatform() === 'android';

/**
 * Lets Android's launch screen leave (ADR 0003). The app holds it from a cold start until the
 * first page is drawn with the device's copy of its notes, so the shell, the page and its notes
 * do not arrive one after another. Only the first call of a page load counts.
 */
export function finishLaunch() {
  if (!launching) return;
  launching = false;
  // The app gives up waiting by itself after a few seconds, so a failed call costs only that.
  LaunchScreen.ready().catch(() => {});
}

/** Lets the launch screen leave once `ready` turns true. */
export function useFinishLaunch(ready: boolean) {
  useEffect(() => {
    if (ready) finishLaunch();
  }, [ready]);
}
