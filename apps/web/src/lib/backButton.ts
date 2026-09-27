import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useRef } from 'react';

type Handler = () => void;

/** Open overlays that the Android back gesture closes, newest last. */
const handlers: Array<{ current: Handler }> = [];

let listening = false;

function listen() {
  if (listening || !Capacitor.isNativePlatform()) return;
  listening = true;
  // Registering a listener replaces Capacitor's default of going back or exiting.
  void App.addListener('backButton', ({ canGoBack }) => {
    const top = handlers.at(-1);
    if (top) top.current();
    else if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });
}

/**
 * While `active`, the Android back gesture calls `onBack` instead of navigating.
 * Overlays that live in the URL (the note editor) do not need this; history closes them.
 */
export function useBackHandler(active: boolean, onBack: Handler) {
  const ref = useRef(onBack);
  ref.current = onBack;

  useEffect(() => {
    listen();
    if (!active) return;
    const entry = { current: () => ref.current() };
    handlers.push(entry);
    return () => {
      handlers.splice(handlers.indexOf(entry), 1);
    };
  }, [active]);
}

/** Installs the back gesture listener even when no overlay is open. */
export function useBackButton() {
  useEffect(listen, []);
}
