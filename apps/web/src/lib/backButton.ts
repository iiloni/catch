import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { useEffect, useRef } from 'react';

type Handler = () => void;

/** Open overlays that the Android back gesture closes, newest last. */
const handlers: Array<{ current: Handler }> = [];
/** Modes the gesture steps out of once no overlay is open, ahead of history; newest last. */
const fallbacks: Array<{ current: Handler }> = [];

let listening = false;

function listen() {
  if (listening || !Capacitor.isNativePlatform()) return;
  listening = true;
  // Registering a listener replaces Capacitor's default of going back or exiting.
  void App.addListener('backButton', ({ canGoBack }) => {
    const top = handlers.at(-1) ?? fallbacks.at(-1);
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
  useHandler(handlers, active, onBack);
}

/**
 * While `active`, the Android back gesture calls `onBack` when no overlay is open, before it
 * would go back in history or leave the app. For a mode of the page itself, such as the
 * vault, which an overlay opened on top of it must still close first.
 */
export function useBackFallback(active: boolean, onBack: Handler) {
  useHandler(fallbacks, active, onBack);
}

function useHandler(list: Array<{ current: Handler }>, active: boolean, onBack: Handler) {
  const ref = useRef(onBack);
  ref.current = onBack;

  useEffect(() => {
    listen();
    if (!active) return;
    const entry = { current: () => ref.current() };
    list.push(entry);
    return () => {
      list.splice(list.indexOf(entry), 1);
    };
  }, [list, active]);
}

/** Installs the back gesture listener even when no overlay is open. */
export function useBackButton() {
  useEffect(listen, []);
}
